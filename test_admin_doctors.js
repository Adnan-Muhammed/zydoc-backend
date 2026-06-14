// const axios = require("axios");

import axios from "axios";
import { log } from "node:console";

async function test() {
  try {
    log("gtfgtf");
    const res = await axios.post("http://localhost:5001/api/admin/auth/login", {
      email: "admin@gmail.com", // Assuming admin seeder email
      password: "123456789",
    });

    // console.log("res:",res.data);

    const token = res.data.accessToken;
console.log("token:",token);

    const docRes = await axios.get("http://localhost:5001/api/admin/doctors", {
      headers: {
        Authorization: `Bearer ${token}`,
        
      },
    });

    console.log('qwerty');
    
    console.log(JSON.stringify(docRes.data, null, 2));
  } catch (e) {
    console.log('its invoke');
    
    console.error(e.response?.data || e.message);
  }
}

test();
