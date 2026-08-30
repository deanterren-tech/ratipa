# RATIPA Full QA/Audit Report

**Date:** 2026-08-29
**Scope:** `src/firebase.ts`, `src/api/index.ts`, `src/services/fleetService.ts`, `src/db/subscriptions.ts`, `src/types.ts`, `src/App.tsx`, `src/hooks/useFleet.ts`, `src/hooks/usePermissions.ts`

---

## 1. Firebase Subscriptions

### 🔴 CRITICAL — F1. saveSettings: dead logAction after return
**File:** `firebase.ts:2044-2084`
**Description:** `saveSettings` returns `new Promise(...)` on line 2047, but `dbService.logAction(...)` is written on lines 2076-2083 **after** the `return`. This code is never reached. Settings changes are never logged to audit.
**Fix:** Move `logAction` before the `return new Promise(...)` block, or chain it via `.then()` inside the promise.

### 🟠 MAJOR — F2. incrementMapboxUsage/loads — potential subscription leak
**File:** `firebase.ts:2733-2743` (and 2763-2773)
**Description:** The error callback `() => { resolve(null); }` never calls `unsub()`. If the `onValue` error handler fires (e.g. permission denied), the listener stays alive forever. Only the data-callback and timeout call `unsub()`.
**Fix:** Add `unsub()` inside the error callback: `() => { unsub(); resolve(null); }`.

### 🟠 MAJOR — F3. getVehicleBrands/getTrailerBrands — no error handlers
**File:** `firebase.ts:1287-1341`
**Description:** Both `onValue` calls pass `() => {}` as error callbacks. If one listener fails silently, `trigger()` may never fire the combined callback, leaving the consumer hanging indefinitely.
**Fix:** Add proper error handling that at least calls `trigger()` so partial data is delivered.

### 🟠 MAJOR — F4. useFleetUnit subscribes to ALL 5 sources for one lookup
**File:** `src/hooks/useFleet.ts:20-36`
**Description:** Calls `subscribeFleetUnits()` which opens 5 Firebase listeners (tractors, trailers, drivers, couplings, dispatchers) and iterates all couplings just to find one unit by carNumber. Very wasteful when a single unit is needed.
**Fix:** Create a dedicated function that reads one coupling + its references via `get()` (once) instead of subscribing to everything.

### 🟠 MAJOR — F5. getCouplingsFlat fallback creates unmanaged listener
**File:** `src/services/fleetService.ts:299-325`
**Description:** When `subscribeFleetUnits` returns empty data, the fallback calls `dbService.getCouplings(...)` which opens a new `onValue` listener. This listener is NOT tracked in `_couplingsFlatUnsub` — it's never cleaned up, even when all callbacks unsubscribe.
**Fix:** Either cache the fallback unsubscribe or use `onceValue` instead of `onValue` for the fallback.

### 🟡 MINOR — F6. catalogCache.users = null on every write
**File:** `firebase.ts:693,699`
**Description:** `saveUsersBatch` and `saveUser` both set `catalogCache.users = null`. This invalidates the cached result, forcing `getUsersOnce` to re-fetch from Firebase next time. Not a bug but causes unnecessary reads.
**Fix:** Consider optimistic cache updates: update users in cache instead of nullifying.

---

## 2. TypeScript Types

### 🔴 CRITICAL — T1. Pervasive `any` types throughout firebase.ts
**Files:** `firebase.ts` — many locations
**Description:** The entire 2803-line file uses `any` for almost every type:
- `export let database: any = null` (line 42)
- `let auth: any = null` (line 41)
- `export const onValue = (dbRef: any, callback: (snapshot: any) => void, ...)` (line 128)
- `sanitizeFirebaseObject = (obj: any): any` (line 344)
- `const cache: any = {}` (line 286)
- `const list: any = []` (line 307)
- All `sharedDir*`, `sharedGet*` functions return `any[]`
**Impact:** Zero type safety. Any refactoring is risky. IDE autocomplete is crippled.
**Fix:** Define proper interfaces for all function signatures. At minimum type `dbRef: DatabaseReference`, `snapshot: DataSnapshot`, callbacks with proper generics.

### 🟠 MAJOR — T2. `{} as any` cast for permissions
**File:** `App.tsx:71`
**Description:** `prof.permissions = {} as any;` — casts empty object to `any`, bypassing the `UserPermissions` type entirely. Any code accessing `prof.permissions.dohod` will get `undefined` instead of a valid permission level.
**Fix:** Create a `createEmptyPermissions(): UserPermissions` factory that returns the correct default structure.

### 🟠 MAJOR — T3. `user as any` cast in saveUser
**File:** `firebase.ts:704`
**Description:** `update(ref(database, ...), user as any)` — the entire `UserProfile` object is cast to `any`, losing all compile-time field validation. If a caller passes an object with misspelled fields, TS won't catch it.
**Fix:** Use proper typing; if RTDB-relevant fields differ from UserProfile, create a `UserProfileDB` type.

### 🟠 MAJOR — T4. sharedGetTractors/Trailers/Couplings typed as `any[]`
**File:** `src/db/subscriptions.ts:144-202`
**Description:** Three core data-fetching functions return `any[]` despite having known shapes:
- tractors: should be `Tractor[]` (or at least `Record<string, unknown>[]`)
- trailers: should be `Trailer[]`
- couplings: should be `Coupling[]`
**Fix:** Define and use proper interfaces.

### 🟠 MAJOR — T5. Duplicated Cyrillic→Latin maps with different implementations
**Files:** `src/hooks/useFleet.ts:39-42`, `src/services/fleetService.ts:71-72`, `firebase.ts:1412-1416`
**Description:** Three different normalization functions exist:
- `fleetService.ts` `norm(s?)` — uppercase, strips non-alphanumeric
- `useFleet.ts` `normStr(s?)` — Cyrillic→Latin + uppercase + strips
- `firebase.ts` inline — specific `CYR_TO_LAT` map + strips
**Impact:** Different components may match differently — same car number may resolve differently.
**Fix:** Extract a single `normalizeCarNumber()` utility and use it everywhere.

### 🟡 MINOR — T6. `customPermissions?: any` in UserProfile
**File:** `types.ts:41`
**Description:** `customPermissions?: any` should have a proper index signature or specific type.
**Fix:** `customPermissions?: Record<string, "none" | "read" | "write">`

---

## 3. Performance

### 🔴 CRITICAL — P1. 5 listeners per subscribeFleetUnits call, no deduplication
**File:** `src/services/fleetService.ts:155-163` (+ consumers like `useFleet.ts`)
**Description:** Every call to `subscribeFleetUnits()` creates 5 Firebase listeners. If 3 components mount (useFleetUnits, useFleetUnit, CouplingCard), that's up to 15 real-time listeners. There's no singleton/shared subscription for the whole fleet.
**Impact:** Heavy battery drain on mobile devices, increased Firebase billing, potential listener limits.
**Fix:** Use `createSharedSubscription` pattern (already exists in `subscriptions.ts!`) for `subscribeFleetUnits` too.

### 🟠 MAJOR — P2. MutationObserver on entire document.body
**File:** `App.tsx:18-32`
**Description:** `MutationObserver` observes `document.body` with `{ childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }`. This fires on **every** DOM mutation anywhere in the app, scanning for `.fixed.inset-0` elements.
**Fix:** Replace with a context-based modal tracking system (e.g. `ModalContext` + `useModal` hook). The current approach is a DOM-scraping hack.

### 🟠 MAJOR — P3. getFleetUnitsOnce uses onValue under the hood
**File:** `src/services/fleetService.ts:168-200`
**Description:** Uses `dbService.getTractors/getTrailers/...` which internally call `sharedGetTractors` which calls `onValue` — a real-time subscription. Despite being called "once", this creates real-time listeners. The `done` counter may never reach 5 if one path is empty (no error callback).
**Fix:** Use direct `onceValue`/`firebaseGet` calls with error fallbacks, not subscription-based helpers.

### 🟡 MINOR — P4. Frequent `JSON.stringify` comparison in hot path
**File:** `App.tsx:124`
**Description:** `JSON.stringify(prev.permissions) === JSON.stringify(me.permissions)` runs on every users_list change. For large permission objects this is wasted work.
**Fix:** Use a deep-comparison utility with early-exit, or compare a hash/version field.

### 🟡 MINOR — P5. `sort()` on every audit log / salary / calculation read
**File:** `firebase.ts` — multiple locations
**Description:** Every `get*` callback sorts the entire list client-side (e.g., `list.sort((a,b) => new Date(b.date)...)`). For large datasets this is O(n log n) on every data change.
**Fix:** Use Firebase's built-in `orderByChild()` and `limitToLast()` instead of sorting client-side.

---

## 4. Security

### 🔴 CRITICAL — S1. No client-side permission checks before writes
**File:** `firebase.ts` — all `save*`/`delete*` methods
**Description:** NONE of the write methods check `user.role` or `user.permissions` before writing to Firebase. Examples:
- `saveSettings` — no check if user is admin
- `saveUser` / `deleteUser` — no check if user is root_admin
- `saveTrip` / `deleteTrip` — no check
- `savePermit` / `deletePermit` — no check
- `saveVehicleDriverRecord` — no check
- `saveSalary` / `deleteSalary` — no check

The only protection is Firebase RTDB security rules. If rules are misconfigured or a bug bypasses auth, any user can modify any data. The audit log is written AFTER the write, so unauthorized writes still happen.
**Fix:** Add client-side guards:
```ts
if (role !== 'root_admin' && role !== 'admin') {
  console.warn('Unauthorized write attempt by', user);
  return;
}
```

### 🟡 MINOR — S2. Dashboard permission silently upgraded for everyone
**File:** `App.tsx:75`
**Description:** `if (!prof.permissions.dashboard || prof.permissions.dashboard === 'none') { prof.permissions.dashboard = 'read'; }` — this silently grants dashboard read access to ALL users, even those explicitly set to 'none'.
**Fix:** Only apply default for specific roles; log a warning when overriding.

### 🟡 MINOR — S3. Passwords stored in plaintext in RTDB
**File:** `firebase.ts:698-750` (saveUser sends `user.password` to RTDB)
**Description:** User passwords are written to `users_list/${uid}/password` in plaintext. Firebase RTDB is not encrypted at the application level.
**Fix:** Remove password from the UserProfile type; use Firebase Auth for password management if needed. At minimum, document that passwords are plaintext.

### 🟡 MINOR — S4. saveVehicleDriverRecord writes to `directories/vehicleBrands` without permission check
**File:** `firebase.ts:1451-1462`
**Description:** Any user can add brand entries to the directories by saving a vehicle. No guard on what can be written.
**Fix:** Validate input or add permission check.

---

## 5. Error Handling

### 🟠 MAJOR — E1. Most write operations silently swallow errors
**File:** `firebase.ts` — many locations
**Description:** Repeating pattern: `.catch((err) => console.warn("Failed X:", err))`. Examples:
- `saveUser` (line 704) — writes to users_list, falls back to localStorage silently
- `saveVehicle` (line 811) — `.catch()` with no user feedback
- `deleteTrip`, `deletePermit`, `deleteFerryTemplate` — no catch at all!
- `bulkUpdateCouplings`, `bulkUpdateDrivers` — silent catch
- `saveDriver` (line 2420) — `.catch()` with console.warn only
**Impact:** Users are never notified when writes fail. Data loss goes unnoticed.
**Fix:** At minimum surface errors to UI. For user-initiated operations, show a toast/alert.

### 🟠 MAJOR — E2. saveSettings double-read race condition
**File:** `firebase.ts:2051-2067`
**Description:** Pattern: read current settings → merge → write merged. If two admin tabs call saveSettings simultaneously, the second read may get stale data, and the first write is overwritten by the second.
**Fix:** Use multi-path `update()` instead of read-then-set. Or use a write lock.

### 🟡 MINOR — E3. No component-level error boundaries
**File:** `ErrorBoundary.tsx` (exists but only wraps `<App />`)
**Description:** ErrorBoundary wraps the entire app in `main.tsx`. A crash in ANY component crashes the whole app.
**Fix:** Add error boundaries at module/section level so a crash in "Dohod" doesn't bring down the entire app.

### 🟡 MINOR — E4. saveSalary `alert()` on error (bad UX in production)
**File:** `firebase.ts:1110`
**Description:** `alert('Ошибка сохранения выплаты: ' + (err?.message || err))` — uses native browser `alert()` which blocks the UI and is unstyled.
**Fix:** Use the app's Toast system instead.

---

## 6. Offline / Network Handling

### 🟠 MAJOR — O1. incrementMapboxUsage/loads: onValue as read, blocks 2s on offline
**File:** `firebase.ts:2729-2757` (and 2759-2787)
**Description:** Uses `onValue` + 2-second timeout + Promise just to READ and increment a counter. On a slow/flaky connection, this takes 2s. Uses real-time subscription for a write operation. Race condition: two tabs can race, losing increments.
**Fix:** Use `firebaseGet` (get()) + `set` or Firebase `runTransaction()` if available. Remove the setTimeout anti-pattern.

### 🟡 MINOR — O2. useFirebase flag never tracks runtime connectivity
**File:** `firebase.ts:43-74` (initialization) + all `if (useFirebase)` checks
**Description:** `useFirebase` is set once during initialization. If the network drops after init, "online" methods will fail, but the flag stays `true`. All writes fail silently.
**Fix:** Add `onDisconnect` or `onValue` error handler that sets a runtime connectivity flag. Listen to `window.addEventListener('online'/'offline')`.

### 🟡 MINOR — O3. No explicit offline retry logic for critical writes
**File:** `firebase.ts` — all write methods
**Description:** Most `update`/`set` calls have `.catch()` that logs to console and falls back to localStorage. But when Firebase comes back online, local changes are never synced up.
**Fix:** Implement a queue of pending writes that replays when connectivity returns.

---

## 7. Dead Code

### 🟠 MAJOR — D1. saveSettings: logAction after return (see F1)
**File:** `firebase.ts:2076-2083`
**Description:** Dead code — `dbService.logAction()` is unreachable after `return new Promise(...)` on line 2047.

### 🟡 MINOR — D2. `INITIAL_VEHICLES` imported but never used
**File:** `firebase.ts:37`
**Description:** `INITIAL_VEHICLES` is imported from `./db/seed` but never referenced anywhere in the file.
**Fix:** Remove the import.

### 🟡 MINOR — D3. `getFleetUnitsOnce` imported but unused in useFleet.ts
**File:** `src/hooks/useFleet.ts:2`
**Description:** `getFleetUnitsOnce` is imported but only `subscribeFleetUnits` is used in the hook.
**Fix:** Remove the unused import.

### 🟡 MINOR — D4. `import type { Vehicle }` in firebase.ts
**File:** `firebase.ts:19`
**Description:** `Vehicle` is imported in the type import block. With the portal schema migration, `Vehicle` type is rarely used in firebase.ts directly (methods return generic `any[]`). The import may be vestigial.
**Fix:** Verify and remove if unused.

---

## 8. Data Consistency

### 🔴 CRITICAL — C1. saveVehicleDriverRecord: non-atomic multi-path writes
**File:** `firebase.ts:1420-1462`
**Description:** Writes to 3-5 paths in separate update/set calls:
1. `tractors/${id}` (line 1420)
2. `drivers/${driverId}` (line 1443)
3. `couplings/${id}` (line 1448)
4. `directories/vehicleBrands/${brandKey}` (line 1454)
5. `directories/trailerBrands/${trailerKey}` (line 1460)

If any one of these fails, data is in an inconsistent state — driver updated but coupling not, tractor updated but directory not. No rollback mechanism.
**Fix:** Wrap in a multi-path `update()` call to a single `ref(database)` so it's atomic (or as atomic as RTDB allows with multi-path updates).

### 🟠 MAJOR — C2. saveSalary writes to 4 paths non-atomically
**File:** `firebase.ts:1102-1108`
**Description:** `update(ref(database), updates)` IS a multi-path update so this one IS atomic — OK actually this is correct. But the structure creates data duplication across `salaryHistory/flat`, `salaryHistory/months`, `salaryHistory/byDispatcher`, and `salaryHistory/`. If the schema changes, all four need migration.

### 🟠 MAJOR — C3. Dispatchers: two inconsistent sources merged
**File:** `firebase.ts:376-486` (directoryService.getDispatchers* methods)
**Description:** Dispatchers come from both `directories/dispatchers` AND `users_list` (filtered by `isDispatcher: true`). The merging logic differs between `getDispatchers`, `getDispatchersFlat`, `getDispatchersWithOrder`, and `getDispatchersObjects`, potentially showing different data depending on which method the caller uses.
**Fix:** Unify all dispatcher queries to use a single source of truth. If a user should be a dispatcher, add them to `directories/dispatchers` instead of relying on the `isDispatcher` flag.

### 🟡 MINOR — C4. FleetUnit field duplication across tractor/coupling/driver
**File:** `src/services/fleetService.ts:109-144`
**Description:** Fields like `brand`, `brandModel`, `trailerBrand`, `dispatcherName` are duplicated in both `tractors` and `couplings` (and sometimes `drivers`). The `raw` field extracts coupling values, but there's no clear priority documented — the code comments say "couplings are priority" but the fallback chains are complex:
```
brand = u.raw?.brand || u.tractor?.brand || u.tractor?.brandModel || ''
```
This creates confusion: editing a brand in the tractor record may not propagate to the coupling, or vice versa.
**Fix:** Document the source-of-truth strategy clearly. Consider migrating to a single-source design where couplings only reference tractor/trailer/driver IDs and all display data comes from the referenced records.

---

## Summary Statistics

| Category | 🔴 Critical | 🟠 Major | 🟡 Minor | Total |
|---|---|---|---|---|
| Firebase Subscriptions | 1 | 4 | 1 | 6 |
| TypeScript Types | 1 | 4 | 1 | 6 |
| Performance | 1 | 3 | 2 | 6 |
| Security | 1 | 0 | 3 | 4 |
| Error Handling | 0 | 2 | 2 | 4 |
| Offline/Network | 0 | 1 | 2 | 3 |
| Dead Code | 0 | 1 | 3 | 4 |
| Data Consistency | 1 | 2 | 1 | 4 |
| **Total** | **5** | **17** | **15** | **37** |

## Top 5 Actions to Take Immediately

1. **🔴 F1: Fix `saveSettings` dead logAction** — settings changes are never audit-logged. Move `logAction` before `return`.
2. **🔴 T1: Start typing `any` types in firebase.ts** — begin with the most-used functions (`onValue`, `onceValue`, `dbService.get*`).
3. **🔴 P1: Share FleetUnit subscriptions** — use the existing `createSharedSubscription` pattern to prevent 15+ listeners.
4. **🔴 S1: Add client-side permission checks** — prevent unauthorized writes even when RTDB rules are misconfigured.
5. **🔴 C1: Make saveVehicleDriverRecord writes atomic** — prevent data inconsistency across tractors/drivers/couplings.

---

*Generated by QA audit of `/Users/sergei/ratipa-fresh-rewrite/src/` — reviewed files: firebase.ts, api/index.ts, services/fleetService.ts, db/subscriptions.ts, types.ts, App.tsx, hooks/useFleet.ts, hooks/usePermissions.ts*