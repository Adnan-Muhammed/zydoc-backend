const cleanText = (value) => {
  if (Array.isArray(value)) value = value.join(", ");
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
};

const hasLetter = (value) => /[\p{L}\p{M}]/u.test(value);
const validName = (value) =>
  value.length <= 50 && hasLetter(value) && /^[\p{L}\p{M} .’'-]+$/u.test(value);
const validPhone = (value) => {
  const digits = value.replace(/\D/g, "");
  return /^\+?[0-9][0-9\s().-]*$/.test(value) && digits.length >= 10 && digits.length <= 15;
};
const validAddress = (value) =>
  value.length >= 5 && value.length <= 200 &&
  /[\p{L}\p{M}\p{N}]/u.test(value) && !/^0+$/.test(value.replace(/\s/g, "")) &&
  /^[\p{L}\p{M}\p{N}\s#.,'’&()/\-]+$/u.test(value);
const validLocality = (value) =>
  value.length >= 2 && value.length <= 100 && hasLetter(value) &&
  /^[\p{L}\p{M}\p{N}\s.'’&()/-]+$/u.test(value);
const validPostalCode = (value) => {
  const compact = value.replace(/[\s-]/g, "");
  return value.length >= 3 && value.length <= 12 &&
    /^[\p{L}\p{N}][\p{L}\p{N} -]*[\p{L}\p{N}]$/u.test(value) &&
    !/^0+$/.test(compact);
};

/** Validate and normalize patient profile data before it reaches persistence. */
export function validatePatientProfilePayload(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const address = source.address && typeof source.address === "object" ? source.address : {};
  const emergencyContact = source.emergencyContact && typeof source.emergencyContact === "object"
    ? source.emergencyContact
    : {};
  const medicalHistory = source.medicalHistory && typeof source.medicalHistory === "object"
    ? source.medicalHistory
    : {};
  const value = (flatKey, nestedValue) => cleanText(source[flatKey] ?? nestedValue);

  const clean = {
    firstName: value("firstName"),
    lastName: value("lastName"),
    dateOfBirth: value("dateOfBirth"),
    gender: value("gender").toLowerCase(),
    phone: value("phone"),
    bloodGroup: value("bloodGroup").toUpperCase(),
    street: value("street", address.street),
    city: value("city", address.city),
    state: value("state", address.state),
    zipCode: value("zipCode", address.zipCode),
    country: value("country", address.country),
    emergencyContactName: value("emergencyContactName", emergencyContact.name),
    emergencyContactRelationship: value("emergencyContactRelationship", emergencyContact.relationship),
    emergencyContactPhone: value("emergencyContactPhone", emergencyContact.phone),
    allergies: value("allergies", medicalHistory.allergies),
    chronicConditions: value("chronicConditions", medicalHistory.chronicConditions),
    currentMedications: value("currentMedications", medicalHistory.currentMedications),
  };
  const errors = {};

  if (!clean.firstName) errors.firstName = "First name is required.";
  else if (!validName(clean.firstName)) errors.firstName = "Enter a valid first name.";
  if (clean.lastName && !validName(clean.lastName)) errors.lastName = "Enter a valid last name.";

  if (!clean.dateOfBirth) {
    errors.dateOfBirth = "Date of birth is required.";
  } else {
    const date = new Date(clean.dateOfBirth);
    if (Number.isNaN(date.getTime())) errors.dateOfBirth = "Enter a valid date of birth.";
    else if (date > new Date()) errors.dateOfBirth = "Date of birth cannot be in the future.";
  }

  if (!["male", "female", "other"].includes(clean.gender)) errors.gender = "Select a valid gender.";
  if (!clean.phone) errors.phone = "Phone number is required.";
  else if (!validPhone(clean.phone)) errors.phone = "Enter a valid phone number with 10 to 15 digits.";
  if (!["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].includes(clean.bloodGroup)) {
    errors.bloodGroup = "Select a valid blood group.";
  }

  if (!clean.street) errors.street = "Street address is required.";
  else if (!validAddress(clean.street)) errors.street = "Enter a valid street address.";
  if (!clean.city) errors.city = "City is required.";
  else if (!validLocality(clean.city)) errors.city = "Enter a valid city.";
  if (!clean.state) errors.state = "State / Province is required.";
  else if (!validLocality(clean.state)) errors.state = "Enter a valid state or province.";
  if (!clean.zipCode) errors.zipCode = "Postal / ZIP code is required.";
  else if (!validPostalCode(clean.zipCode)) errors.zipCode = "Enter a valid postal / ZIP code.";
  if (!clean.country) errors.country = "Country is required.";
  else if (clean.country.length < 2 || clean.country.length > 80 || !hasLetter(clean.country) || !/^[\p{L}\p{M}\s.'’()-]+$/u.test(clean.country)) {
    errors.country = "Enter a valid country.";
  }

  if (clean.emergencyContactName && !validName(clean.emergencyContactName)) {
    errors.emergencyContactName = "Enter a valid contact name.";
  }
  if (clean.emergencyContactRelationship &&
      (clean.emergencyContactRelationship.length > 50 || !hasLetter(clean.emergencyContactRelationship) || !/^[\p{L}\p{M}\s.'’()-]+$/u.test(clean.emergencyContactRelationship))) {
    errors.emergencyContactRelationship = "Enter a valid relationship.";
  }
  if (clean.emergencyContactPhone && !validPhone(clean.emergencyContactPhone)) {
    errors.emergencyContactPhone = "Enter a valid contact phone number.";
  }
  for (const field of ["allergies", "chronicConditions", "currentMedications"]) {
    if (clean[field].length > 2000) errors[field] = "This field must be 2000 characters or fewer.";
  }

  return { errors, clean };
}
