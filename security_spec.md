# DiwaPAY Firestore Security Specification

## 1. Data Invariants
1. **Owner-Bound Account Records**: Every document at `/accounts/{accountId}` must belong to `request.auth.uid` (`accountId == request.auth.uid` and `ownerUid == request.auth.uid`).
2. **Verified Email Requirement**: All standard writes and reads require `request.auth != null && request.auth.token.email_verified == true`.
3. **No Plaintext Credentials**: Plaintext passwords, OTPs, and MPINs are never accepted or stored in Firestore (`hasOnly` strictly enforces only allowed profile keys, and `credentialStatus` must equal `'Protected'`).
4. **Immutable Ownership & Creation Time**: `ownerUid` and `createdAt` cannot change on update; `createdAt` and `updatedAt` must match `request.time`.
5. **PII Isolation & Admin Access**: Account `get` is restricted to the document owner or admin; `list` is restricted to the verified bootstrapped admin (`monikaverma25595@gmail.com`) or owner-scoped queries without `get()`/`exists()` inside `allow list`.

## 2. Adversarial "Dirty Dozen" Payloads (All Must Return PERMISSION_DENIED)
1. Unauthenticated read/list on `/accounts`.
2. Unauthenticated create on `/accounts/{uid}`.
3. Spoofed `ownerUid` (`ownerUid !== request.auth.uid`) on create.
4. Ghost/shadow field injection (`{ ..., password: "secret", isAdmin: true }`) on create or update.
5. Unverified email token (`email_verified: false`) attempting write or admin read.
6. Non-owner reading another user's `/accounts/{otherUid}` document.
7. Non-admin executing an unbounded `list` query on `/accounts`.
8. Oversized `fullName` (> 80 chars) or empty `fullName` (< 2 chars).
9. Unsupported `countryCode` (not in `['+91', '+1', '+44', '+971', '+65']`).
10. Client-forged `createdAt` or `updatedAt` timestamp not equal to `request.time`.
11. Mutating `ownerUid` or `createdAt` during an update.
12. Poisoned document ID (`accountId` > 128 chars or containing special characters like `/../`).
