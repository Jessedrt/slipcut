# Runtime reliability fix

This change addresses the production failures observed on 2026-10-10:

- `/api/miniapp/cut` exceeded the 60-second Vercel runtime limit when deep live research chained multiple provider timeouts. Cut now has a 28-second deep-analysis budget and returns a clearly labeled market-implied fallback instead of allowing the function to be killed.
- Cold `/api/engine` rebuilds booked six ladder cards serially. Engine now plans the same cards first and validates/books up to three cards concurrently, preserving the existing selection rules while shortening cold rebuilds.
- The pg driver warned that `sslmode=require` semantics will change in a future major release. Production builds now normalize the connection string to explicit `sslmode=verify-full`, matching the secure behavior pg is currently applying.

No risk ranges, market allow/deny rules, Longshot 48-hour policy, or Build game limits are changed by this patch.
