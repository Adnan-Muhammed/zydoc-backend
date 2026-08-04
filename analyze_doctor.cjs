// analyze_doctor.cjs - Run with: node analyze_doctor.cjs
const { MongoClient } = require('mongodb');

const MONGO_URI = 'mongodb://127.0.0.1:27017/zydoc-app';

async function analyzeDoctor() {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db('zydoc-app');

    // ── 1. Find the doctor by name ──────────────────────────────────────────
    const doctors = db.collection('doctors');
    const doctor = await doctors.findOne({
        $or: [
            { firstName: { $regex: 'Doc2A', $options: 'i' } },
            { lastName:  { $regex: 'Cert2', $options: 'i' } },
            { firstName: { $regex: 'Cert2', $options: 'i' } },
            { lastName:  { $regex: 'Doc2A', $options: 'i' } },
        ]
    });

    if (!doctor) {
        console.log('❌  Doctor not found. Listing all doctors for reference:\n');
        const all = await doctors.find({}, { projection: { firstName:1, lastName:1, _id:1 } }).toArray();
        all.forEach(d => console.log(`  • ${d.firstName} ${d.lastName}  [${d._id}]`));
        await client.close();
        return;
    }

    console.log('════════════════════════════════════════════════════════');
    console.log(`  Doctor: ${doctor.firstName} ${doctor.lastName}`);
    console.log(`  ID    : ${doctor._id}`);
    console.log(`  Status: ${doctor.verificationStatus}`);
    console.log('════════════════════════════════════════════════════════\n');

    // ── 2. Working hours analysis ───────────────────────────────────────────
    const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const CHANNEL_LABELS = { online: '🟦 ONLINE (video)', offline: '🟩 OFFLINE (physical)' };

    for (const [channel, label] of Object.entries(CHANNEL_LABELS)) {
        console.log(`\n${label}`);
        const wh = doctor.workingHours?.[channel] || {};
        const hasAnyActive = Object.values(wh).some(s => s?.active === true);

        if (!hasAnyActive) {
            console.log('  ⚠️  No active days configured → MVP fallback (Mon–Fri 09:00–17:00)');
        }

        const rows = [];
        // monday-to-friday block first
        if (wh.mondayToFriday) {
            rows.push({ key: 'mondayToFriday (block)', ...wh.mondayToFriday });
        }
        for (const day of DAY_NAMES) {
            if (wh[day]) rows.push({ key: day, ...wh[day] });
        }

        for (const r of rows) {
            const status = r.active ? '✅ Active' : '❌ Closed';
            const hours  = r.active ? `  ${r.start} – ${r.end}` : '';
            console.log(`  ${r.key.padEnd(22)} ${status}${hours}`);
        }
    }

    // ── 3. Slot count for next 30 days ─────────────────────────────────────
    console.log('\n\n📅  AVAILABILITY — NEXT 30 DAYS\n');
    const now = new Date();

    function getSchedule(wh, jsDay) {
        const dayName = DAY_NAMES[jsDay];
        const isWeekday = jsDay >= 1 && jsDay <= 5;
        let sch = wh[dayName];
        if ((!sch || !sch.active) && isWeekday && wh.mondayToFriday?.active) sch = wh.mondayToFriday;
        const hasAnyActive = Object.values(wh).some(s => s?.active === true);
        if (!sch || !sch.active) {
            if (hasAnyActive) return null; // explicitly closed
            if (!isWeekday) return null;   // no config + weekend
            return { start: '09:00', end: '17:00' }; // MVP fallback
        }
        return sch;
    }

    function countSlots(start, end) {
        let [h, m] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        let count = 0;
        while (h < eh || (h === eh && m < em)) {
            count++;
            m += 30;
            if (m >= 60) { m -= 60; h++; }
        }
        return count;
    }

    const appointments = db.collection('appointments');
    const doctorId = doctor._id;

    // Build 4-week calendar
    let weekRows = [];
    let currentWeek = [];
    let weekNum = 1;

    for (let i = 0; i < 30; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
        const jsDay = d.getUTCDay();
        const dateStr = d.toISOString().slice(0, 10);

        // count booked slots for this day
        const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
        const end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59));
        const booked = await appointments.countDocuments({
            doctorId,
            appointmentDate: { $gte: start, $lte: end },
            status: { $ne: 'cancelled' }
        });

        const onlineSch  = getSchedule(doctor.workingHours?.online  || {}, jsDay);
        const offlineSch = getSchedule(doctor.workingHours?.offline || {}, jsDay);

        const onlineSlots  = onlineSch  ? countSlots(onlineSch.start,  onlineSch.end)  : 0;
        const offlineSlots = offlineSch ? countSlots(offlineSch.start, offlineSch.end) : 0;
        const totalSlots   = Math.max(onlineSlots, offlineSlots);

        currentWeek.push({ dateStr, jsDay, totalSlots, booked, onlineSlots, offlineSlots });

        if (jsDay === 6 || i === 29) {
            weekRows.push({ weekNum, days: [...currentWeek] });
            currentWeek = [];
            weekNum++;
        }
    }

    const DAY_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];

    for (const week of weekRows) {
        console.log(`  Week ${week.weekNum}`);
        for (const d of week.days) {
            const dayLabel = DAY_SHORT[d.jsDay];
            const avail = d.totalSlots - d.booked;
            const bar = avail > 0
                ? '🟢 ' + '█'.repeat(Math.min(avail, 10)) + (avail > 10 ? `+${avail-10}` : '')
                : d.totalSlots === 0 ? '⛔ Closed' : '🔴 Fully booked';
            console.log(`    ${d.dateStr} (${dayLabel})  online:${d.onlineSlots}  physical:${d.offlineSlots}  booked:${d.booked}  available:${avail}  ${bar}`);
        }
        console.log();
    }

    // ── 4. Monthly summary ─────────────────────────────────────────────────
    console.log('\n📊  MONTHLY SUMMARY (July 2026)');
    let totalAvail = 0, totalBooked = 0, closedDays = 0;
    for (const week of weekRows) {
        for (const d of week.days) {
            if (d.totalSlots === 0) closedDays++;
            else { totalAvail += d.totalSlots - d.booked; totalBooked += d.booked; }
        }
    }
    console.log(`  Total open slots  : ${totalAvail + totalBooked}`);
    console.log(`  Booked            : ${totalBooked}`);
    console.log(`  Still available   : ${totalAvail}`);
    console.log(`  Closed / off days : ${closedDays}\n`);

    await client.close();
}

analyzeDoctor().catch(console.error);
