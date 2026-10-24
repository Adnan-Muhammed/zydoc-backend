// src/presentation/validators/profileValidator.js

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'`-]{1,49}$/u;
const REG_RE = /^[A-Za-z0-9][A-Za-z0-9\-/. ]{2,29}$/;

const text = (v, max, { multiline = false } = {}) => {
    if (typeof v !== 'string') return '';
    let s = v.replace(CONTROL, '');
    if (!multiline) s = s.replace(/[\r\n\t]+/g, ' ');
    return s.trim().slice(0, max);
};

const fee = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
};

export function validateProfilePayload(raw, { qualFileCount = 0 } = {}) {
    const errors = {};
    const d = raw && typeof raw === 'object' ? raw : {};
    const currentYear = new Date().getFullYear();

    const firstName = text(d.firstName, 50);
    const lastName = text(d.lastName, 50);
    if (!NAME_RE.test(firstName)) errors.firstName = 'Enter a valid first name.';
    if (!NAME_RE.test(lastName)) errors.lastName = 'Enter a valid last name.';

    const phoneRaw = text(d.phone, 20);
    const digits = phoneRaw.replace(/\D/g, '');
    if (!/^\+?[\d\s\-()\[\]]+$/.test(phoneRaw) || digits.length < 10 || digits.length > 15) {
        errors.phone = 'Enter a valid phone number.';
    }
    const phone = (phoneRaw.startsWith('+') ? '+' : '') + digits;

    const bio = text(d.bio, 1000, { multiline: true });
    const specialty = text(d.specialty, 80);
    if (specialty.length < 2) errors.specialty = 'Specialty is required.';

    const yearsOfExperience = Number(d.yearsOfExperience);
    if (!Number.isInteger(yearsOfExperience) || yearsOfExperience < 0 || yearsOfExperience > 70) {
        errors.yearsOfExperience = 'Years of experience must be between 0 and 70.';
    }

    const regNumber = text(d.registration?.number, 30);
    const council = text(d.registration?.council, 100);
    if (!REG_RE.test(regNumber)) errors.licenseNumber = 'Enter a valid registration number.';
    if (council.length < 2) errors.council = 'Medical council is required.';

    // Qualifications
    const qualifications = [];
    const usedIndexes = new Set();
    const rawQuals = Array.isArray(d.qualifications) ? d.qualifications.slice(0, 5) : [];
    rawQuals.forEach((q, i) => {
        const id = text(q?.id, 40) || String(i);
        const degree = text(q?.degree, 100);
        const university = text(q?.university, 150);
        const year = Number(q?.year);
        let ok = true;
        if (degree.length < 2) { errors[`qual:${id}:degree`] = 'Degree is required.'; ok = false; }
        if (university.length < 2) { errors[`qual:${id}:university`] = 'University is required.'; ok = false; }
        if (!Number.isInteger(year) || year < 1950 || year > currentYear) {
            errors[`qual:${id}:year`] = 'Invalid year.';
            ok = false;
        }

        let certificateIndex = null;
        if (q?.certificateIndex !== null && q?.certificateIndex !== undefined) {
            const idx = Number(q.certificateIndex);
            if (!Number.isInteger(idx) || idx < 0 || idx >= qualFileCount || usedIndexes.has(idx)) {
                errors[`qual:${id}`] = 'Certificate file mismatch. Please re-attach it.';
                ok = false;
            } else {
                usedIndexes.add(idx);
                certificateIndex = idx;
            }
        }
        if (ok) qualifications.push({ degree, university, year, certificateIndex });
    });
    if (qualifications.length === 0 && !Object.keys(errors).some((k) => k.startsWith('qual:'))) {
        errors.qualifications = 'Add at least one qualification.';
    }

    // Consultation
    const online = d.consultationSettings?.online ?? {};
    const offline = d.consultationSettings?.offline ?? {};
    const onlineEnabled = online.enabled === true;
    const offlineEnabled = offline.enabled === true;
    if (!onlineEnabled && !offlineEnabled) errors.consultation = 'Enable at least one consultation type.';

    const onlineFee = onlineEnabled ? fee(online.fee) : 0;
    if (onlineEnabled && onlineFee === null) errors.telehealthFee = 'Enter a valid fee.';

    const offlineFee = offlineEnabled ? fee(offline.fee) : 0;
    const clinicName = offlineEnabled ? text(offline.clinicName, 120) : '';
    const clinicAddress = offlineEnabled ? text(offline.clinicAddress, 300, { multiline: true }) : '';
    if (offlineEnabled) {
        if (offlineFee === null) errors.inPersonFee = 'Enter a valid fee.';
        if (clinicName.length < 2) errors.clinicName = 'Clinic name is required.';
        if (clinicAddress.length < 5) errors.clinicAddress = 'Clinic address is required.';
    }

    return {
        errors,
        clean: {
            firstName, lastName, phone, bio, specialty, yearsOfExperience,
            registration: { number: regNumber, council },
            qualifications,
            consultationSettings: {
                online: { enabled: onlineEnabled, fee: onlineFee ?? 0 },
                offline: { enabled: offlineEnabled, fee: offlineFee ?? 0, clinicName, clinicAddress },
            },
        },
    };
}
