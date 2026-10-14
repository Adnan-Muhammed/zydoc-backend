# Backend tests

This folder contains automated tests written with Node.js's built-in `node:test` runner.
This Markdown file is documentation only; it does not run tests.

## Run all tests

From the backend project folder, run either command:

```powershell
npm test
```

or:

```powershell
node --test
```

Both commands discover and run the `*.test.js` files in this folder.

## Run one test file

From the backend project folder, pass the test file path to Node:

```powershell
node --test tests/p0-authorization.test.js
```

Replace the filename with another `*.test.js` file in this folder as needed.

## Standalone wallet check script

Inside this folder, `testWalletBackend.js` is a standalone assertion-based verification script. Because it does not follow the `*.test.js` naming convention, it is not executed automatically by `npm test` (`node --test`).

### Purpose
- **In-Memory Logic & Schema Verification:** Validates Mongoose schema paths (`PatientProfile`, `WalletTransaction`, `Appointment`), repository interfaces, and use cases (credit/debit, split payments, 24-hour cancellation rules).
- **Zero Database & Gateway Dependency:** Uses in-memory mock repositories and services; it does not connect to a live MongoDB database or an external payment gateway.

### How to run

From the backend project root, run:

```powershell
node tests/testWalletBackend.js
```

## Safety

Do not point tests at a production database. The current `tests/*.test.js` files use mocked model methods and test data; the standalone `testWalletBackend.js` script uses mock repositories and services in-memory for its payment and wallet scenarios. Review the code before adding tests that connect to external services or perform real database writes.
