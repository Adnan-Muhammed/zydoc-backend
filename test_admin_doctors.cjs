const axios = require('axios');

async function test() {
    try {
        const res = await axios.post('http://localhost:5000/api/auth/login', {
            email: 'admin@gmail.com', // Assuming admin seeder email
            password: '123456789'
        });

        const token = res.data.accessToken;

        const docRes = await axios.get('http://localhost:5000/api/admin/doctors', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        console.log(JSON.stringify(docRes.data, null, 2));
    } catch (e) {
        console.error(e.response?.data || e.message);
    }
}

test();
