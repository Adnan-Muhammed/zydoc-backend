import axios from "axios";

async function run() {
  try {
    console.log("=== Testing GET /api/doctors ===");
    const res = await axios.get("http://localhost:5001/api/doctors");
    console.log("Response Status:", res.status);
    console.log("Response Data:", JSON.stringify(res.data, null, 2));

    if (res.data.doctors && res.data.doctors.length > 0) {
      const docId = res.data.doctors[0].id;
      console.log(`\n=== Testing GET /api/doctors/${docId} ===`);
      const detailRes = await axios.get(`http://localhost:5001/api/doctors/${docId}`);
      console.log("Detail Status:", detailRes.status);
      console.log("Detail Data:", JSON.stringify(detailRes.data, null, 2));

      // Test specialty filter
      console.log(`\n=== Testing GET /api/doctors?specialty=Pediatrics ===`);
      const filterRes = await axios.get("http://localhost:5001/api/doctors?specialty=Pediatrics");
      console.log("Pediatrics Filter Status:", filterRes.status);
      console.log("Pediatrics Doctors Count:", filterRes.data.doctors.length);

      // Test experience sort (descending)
      console.log(`\n=== Testing GET /api/doctors?sortBy=experience&sortOrder=desc ===`);
      const sortRes = await axios.get("http://localhost:5001/api/doctors?sortBy=experience&sortOrder=desc");
      console.log("Sort Status:", sortRes.status);
      console.log("Sort Order Experiences:", sortRes.data.doctors.map(d => `${d.name}: ${d.yearsOfExperience} years`));
    } else {
      console.log("\nNo approved doctors found in the database. To test filtering/detail page fully, please ensure at least one doctor has verificationStatus = 'approved'.");
    }
  } catch (error) {
    console.error("Test failed:", error.response?.data || error.message);
  }
}

run();
