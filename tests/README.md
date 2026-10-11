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

## Separate wallet check script

The wallet check script is outside this folder and is not included in `npm test` or the default `node --test` discovery. To run it separately:

```powershell
node scripts/testWalletBackend.js
```

## Safety

Do not point tests at a production database. The current `tests/*.test.js` files use mocked model methods and test data; the separate wallet script uses mock repositories/services for its payment and wallet scenarios. Review the code before adding tests that connect to external services or perform real database writes.
