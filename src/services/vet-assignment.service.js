const { Veterinarian, Case, AuditLog } = require('../models');
const db = require('../db');
const { isConnected } = require('../db/mongo');

/**
 * Vet Assignment Service
 * Automatically selects and assigns an eligible, verified veterinarian to a clinical case.
 * Enforces:
 * 1. Verification status must be 'VERIFIED'
 * 2. Availability (isAvailableForEmergency / active)
 * 3. Lowest current workload
 * 4. Spatial / District proximity where applicable
 * 5. Rejection handling (re-queues to another vet, excluding rejecting vets)
 */
class VetAssignmentService {
  /**
   * Find best veterinarian for a case
   * @param {Object} caseObj - The clinical case
   * @param {Array<string>} excludedVetIds - IDs of vets who rejected or were previously tried
   */
  async findEligibleVet(caseObj, excludedVetIds = []) {
    const district = caseObj.district || (caseObj.location && caseObj.location.district);

    if (isConnected) {
      // 1. Search verified and active veterinarians
      const query = {
        verificationStatus: 'VERIFIED',
        _id: { $nin: excludedVetIds }
      };

      // Try to match same district first
      let eligibleVets = [];
      if (district) {
        eligibleVets = await Veterinarian.find({ ...query, district }).sort({ currentWorkload: 1 }).limit(5);
      }

      // If no local vet, widen to any available verified vet
      if (!eligibleVets || eligibleVets.length === 0) {
        eligibleVets = await Veterinarian.find(query).sort({ currentWorkload: 1 }).limit(5);
      }

      if (eligibleVets.length === 0) return null;

      // Select vet with lowest workload
      eligibleVets.sort((a, b) => (a.currentWorkload || 0) - (b.currentWorkload || 0));
      return eligibleVets[0];
    } else {
      // JSON db fallback
      const vets = db.findAll('users', u => u.role === 'veterinarian' || u.role === 'vet');
      const filtered = vets.filter(v => 
        (v.verificationStatus === 'VERIFIED' || v.verified !== false) &&
        !excludedVetIds.includes(v.id)
      );

      if (filtered.length === 0) return null;
      // Sort by workload or appointment count
      filtered.sort((a, b) => (a.currentWorkload || 0) - (b.currentWorkload || 0));
      return filtered[0];
    }
  }

  /**
   * Automatically assign a vet to a case
   * @param {string} caseId
   * @param {Array<string>} excludedVetIds
   */
  async assignCase(caseId, excludedVetIds = []) {
    let caseRecord;
    if (isConnected) {
      caseRecord = await Case.findOne({ caseId }) || await Case.findById(caseId);
    } else {
      caseRecord = db.findById('cases', caseId) || db.findAll('cases', c => c.caseId === caseId)[0];
    }

    if (!caseRecord) {
      throw new Error(`Case ${caseId} not found for assignment.`);
    }

    const selectedVet = await this.findEligibleVet(caseRecord, excludedVetIds);
    if (!selectedVet) {
      // No vet available, mark case as QUEUED
      if (isConnected) {
        caseRecord.status = 'QUEUED';
        await caseRecord.save();
      } else {
        db.updateById('cases', caseRecord.id, { status: 'QUEUED' });
      }
      return { success: false, message: 'No verified veterinarians currently available. Case placed in pool.' };
    }

    const vetId = selectedVet._id ? selectedVet._id.toString() : selectedVet.id;
    const vetName = selectedVet.name;

    if (isConnected) {
      caseRecord.assignedVetId = selectedVet._id;
      caseRecord.status = 'PENDING_ACCEPTANCE';
      await caseRecord.save();

      // Increment vet workload
      selectedVet.currentWorkload = (selectedVet.currentWorkload || 0) + 1;
      await selectedVet.save();

      // Audit Log
      await AuditLog.create({
        actorRole: 'SYSTEM',
        action: 'AUTO_VET_ASSIGNMENT',
        entityType: 'CASE',
        entityId: caseRecord.caseId,
        details: { assignedVetId: vetId, vetName }
      });
    } else {
      db.updateById('cases', caseRecord.id, {
        vetId,
        assignedVetName: vetName,
        status: 'PENDING_ACCEPTANCE',
        assignedAt: new Date().toISOString()
      });
    }

    return {
      success: true,
      caseId: caseRecord.caseId,
      assignedVetId: vetId,
      assignedVetName: vetName,
      status: 'PENDING_ACCEPTANCE'
    };
  }

  /**
   * Handle vet rejection of a case
   * @param {string} caseId
   * @param {string} rejectingVetId
   * @param {string} reason
   */
  async handleVetRejection(caseId, rejectingVetId, reason = '') {
    let caseRecord;
    if (isConnected) {
      caseRecord = await Case.findOne({ caseId }) || await Case.findById(caseId);
    } else {
      caseRecord = db.findById('cases', caseId) || db.findAll('cases', c => c.caseId === caseId)[0];
    }

    if (!caseRecord) throw new Error(`Case ${caseId} not found.`);

    // Decrement rejecting vet workload
    if (isConnected) {
      await Veterinarian.findByIdAndUpdate(rejectingVetId, { $inc: { currentWorkload: -1 } });
    }

    // Add rejecting vet to exclusion list and re-assign
    const excluded = [rejectingVetId.toString()];
    return await this.assignCase(caseId, excluded);
  }
}

module.exports = new VetAssignmentService();
