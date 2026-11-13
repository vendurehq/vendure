
### typeorm-0.3.28 / postgres

| Scenario | createdAt (DB default) | updatedAt | Date cols (orderPlacedAt etc.) | custom field datetime | timestamptz col | createdAt as timestamptz | raw stored vs UTC (Date cols) | list filter (Date cols) | list filter (timestamptz) | metrics day bucket |
|---|---|---|---|---|---|---|---|---|---|---|
| TZ=UTC, pg server UTC, session: server default | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, pg server UTC, session: server default | ❌ -1h | ❌ -1h | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ✅ | ✅ | ❌ +1h / +2h | ❌ misses 10/10 | ✅ | same |
| TZ=America/Los_Angeles, pg server UTC, session: server default | ❌ +8h | ❌ +8h | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ✅ | ✅ | ❌ -8h / -7h | ❌ misses 10/10 | ✅ | Node-local day |
| TZ=Asia/Kolkata, pg server UTC, session: server default | ❌ -5.5h | ❌ -5.5h | ✅ | ✅ | ✅ | ✅ | ❌ +5.5h | ❌ misses 10/10 | ✅ | Node-local day |
| TZ=UTC, pg server UTC, session: -c timezone=UTC | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, pg server UTC, session: -c timezone=UTC | ❌ -1h | ❌ -1h | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ✅ | ✅ | ❌ +1h / +2h | ❌ misses 10/10 | ✅ | same |
| TZ=America/Los_Angeles, pg server UTC, session: -c timezone=UTC | ❌ +8h | ❌ +8h | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ✅ | ✅ | ❌ -8h / -7h | ❌ misses 10/10 | ✅ | Node-local day |
| TZ=Asia/Kolkata, pg server UTC, session: -c timezone=UTC | ❌ -5.5h | ❌ -5.5h | ✅ | ✅ | ✅ | ✅ | ❌ +5.5h | ❌ misses 10/10 | ✅ | Node-local day |
| TZ=UTC, pg server Europe/Vienna, session: server default | ❌ +1h | ❌ +1h | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ misses 10/10 | same |
| TZ=Europe/Vienna, pg server Europe/Vienna, session: server default | ✅ | ✅ | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ✅ | ✅ | ❌ +1h / +2h | ❌ misses 10/10 | ❌ misses 10/10 | same |
| TZ=America/Los_Angeles, pg server Europe/Vienna, session: server default | ❌ +9h | ❌ +9h | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ✅ | ✅ | ❌ -8h / -7h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ=Asia/Kolkata, pg server Europe/Vienna, session: server default | ❌ -4.5h | ❌ -4.5h | ✅ | ✅ | ✅ | ✅ | ❌ +5.5h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ=UTC, pg server Europe/Vienna, session: -c timezone=UTC | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, pg server Europe/Vienna, session: -c timezone=UTC | ❌ -1h | ❌ -1h | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ✅ | ✅ | ❌ +1h / +2h | ❌ misses 10/10 | ✅ | same |
| TZ=America/Los_Angeles, pg server Europe/Vienna, session: -c timezone=UTC | ❌ +8h | ❌ +8h | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ✅ | ✅ | ❌ -8h / -7h | ❌ misses 10/10 | ✅ | Node-local day |
| TZ=Asia/Kolkata, pg server Europe/Vienna, session: -c timezone=UTC | ❌ -5.5h | ❌ -5.5h | ✅ | ✅ | ✅ | ✅ | ❌ +5.5h | ❌ misses 10/10 | ✅ | Node-local day |
| TZ=UTC, pg server America/Los_Angeles, session: server default | ❌ -8h | ❌ -8h | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ misses 10/10 | same |
| TZ=Europe/Vienna, pg server America/Los_Angeles, session: server default | ❌ -9h | ❌ -9h | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ✅ | ✅ | ❌ +1h / +2h | ❌ misses 10/10 | ❌ misses 10/10 | same |
| TZ=America/Los_Angeles, pg server America/Los_Angeles, session: server default | ✅ | ✅ | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ✅ | ✅ | ❌ -8h / -7h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ=Asia/Kolkata, pg server America/Los_Angeles, session: server default | ❌ -13.5h | ❌ -13.5h | ✅ | ✅ | ✅ | ✅ | ❌ +5.5h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ=UTC, pg server America/Los_Angeles, session: -c timezone=UTC | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, pg server America/Los_Angeles, session: -c timezone=UTC | ❌ -1h | ❌ -1h | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ✅ | ✅ | ❌ +1h / +2h | ❌ misses 10/10 | ✅ | same |
| TZ=America/Los_Angeles, pg server America/Los_Angeles, session: -c timezone=UTC | ❌ +8h | ❌ +8h | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ✅ | ✅ | ❌ -8h / -7h | ❌ misses 10/10 | ✅ | Node-local day |
| TZ=Asia/Kolkata, pg server America/Los_Angeles, session: -c timezone=UTC | ❌ -5.5h | ❌ -5.5h | ✅ | ✅ | ✅ | ✅ | ❌ +5.5h | ❌ misses 10/10 | ✅ | Node-local day |
| TZ Europe/Vienna → UTC, pg server UTC, session: server default | ✅ | ✅ | ❌ +1h / +2h | ❌ +1h / +2h | ✅ | ✅ | ❌ +1h / +2h | ❌ misses 10/10 | ✅ | same |
| TZ UTC → Europe/Vienna, pg server UTC, session: server default | ❌ -1h | ❌ -1h | ❌ -1h / -2h | ❌ -1h / -2h | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ UTC → America/Los_Angeles, pg server UTC, session: server default | ❌ +8h | ❌ +8h | ❌ +8h / +7h | ❌ +8h / +7h | ✅ | ✅ | ✅ | ✅ | ✅ | UTC day |
| TZ America/Los_Angeles → UTC, pg server UTC, session: server default | ✅ | ✅ | ❌ -8h / -7h | ❌ -8h / -7h | ✅ | ✅ | ❌ -8h / -7h | ❌ misses 10/10 | ✅ | other: 2026-03-28 for viennaSpringGap, other: 2026-03-28 for utcInViennaGap, other: 2026-10-24 for viennaFallBack1, other: 2026-10-24 for viennaFallBack2 |
| TZ Asia/Kolkata → UTC, pg server UTC, session: server default | ✅ | ✅ | ❌ +5.5h | ❌ +5.5h | ✅ | ✅ | ❌ +5.5h | ❌ misses 10/10 | ✅ | other: 2026-05-11 for kolkataMidnight |
| TZ=UTC, pg server UTC, session: PGTZ=Europe/Vienna env | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |

### typeorm-0.3.28 / mysql

| Scenario | createdAt (DB default) | updatedAt | Date cols (orderPlacedAt etc.) | custom field datetime | TIMESTAMP col | createdAt as TIMESTAMP | raw stored vs UTC (Date cols) | list filter (Date cols) | list filter (TIMESTAMP) | metrics day bucket |
|---|---|---|---|---|---|---|---|---|---|---|
| TZ=UTC, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ=America/Los_Angeles, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UTC day |
| TZ=Asia/Kolkata, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UTC day |
| TZ=UTC, time_zone +00:00, typeorm tz 'local' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, time_zone +00:00, typeorm tz 'local' | ❌ -1h | ❌ -1h | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ❌ -1h | ❌ +1h / +2h | ❌ misses 10/10 | ❌ misses 10/10 | same |
| TZ=America/Los_Angeles, time_zone +00:00, typeorm tz 'local' | ❌ +8h | ❌ +8h | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ❌ +8h | ❌ -8h / -7h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ=Asia/Kolkata, time_zone +00:00, typeorm tz 'local' | ❌ -5.5h | ❌ -5.5h | ✅ | ✅ | ✅ | ❌ -5.5h | ❌ +5.5h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ=UTC, time_zone Europe/Vienna, typeorm tz 'Z' | ❌ +1h | ❌ +1h | ✅ | ✅ | 💥 insert fails (utcInViennaGap) | ❌ +1h | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, time_zone Europe/Vienna, typeorm tz 'Z' | ❌ +1h | ❌ +1h | ✅ | ✅ | 💥 insert fails (utcInViennaGap) | ❌ +1h | ✅ | ✅ | ✅ | same |
| TZ=America/Los_Angeles, time_zone Europe/Vienna, typeorm tz 'Z' | ❌ +1h | ❌ +1h | ✅ | ✅ | 💥 insert fails (utcInViennaGap) | ❌ +1h | ✅ | ✅ | ✅ | UTC day |
| TZ=Asia/Kolkata, time_zone Europe/Vienna, typeorm tz 'Z' | ❌ +1h | ❌ +1h | ✅ | ✅ | 💥 insert fails (utcInViennaGap) | ❌ +1h | ✅ | ✅ | ✅ | UTC day |
| TZ=UTC, time_zone Europe/Vienna, typeorm tz 'local' | ❌ +1h | ❌ +1h | ✅ | ✅ | 💥 insert fails (utcInViennaGap) | ❌ +1h | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, time_zone Europe/Vienna, typeorm tz 'local' | ✅ | ✅ | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ✅ | ❌ +1h / +2h | ❌ misses 10/10 | ❌ misses 10/10 | same |
| TZ=America/Los_Angeles, time_zone Europe/Vienna, typeorm tz 'local' | ❌ +9h | ❌ +9h | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ❌ +9h | ❌ -8h / -7h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ=Asia/Kolkata, time_zone Europe/Vienna, typeorm tz 'local' | ❌ -4.5h | ❌ -4.5h | ✅ | ✅ | ✅ | ❌ -4.5h | ❌ +5.5h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ Europe/Vienna → UTC, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ Europe/Vienna → UTC, time_zone +00:00, typeorm tz 'local' | ✅ | ✅ | ❌ +1h / +2h | ❌ +1h / +2h | ❌ +1h / +2h | ✅ | ❌ +1h / +2h | ❌ misses 10/10 | ❌ misses 10/10 | same |
| TZ UTC → America/Los_Angeles, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UTC day |
| TZ UTC → America/Los_Angeles, time_zone +00:00, typeorm tz 'local' | ❌ +8h | ❌ +8h | ❌ +8h / +7h | ❌ +8h / +7h | ❌ +8h / +7h | ❌ +8h | ✅ | ✅ | ✅ | UTC day |

### typeorm-0.3.28 / mariadb

| Scenario | createdAt (DB default) | updatedAt | Date cols (orderPlacedAt etc.) | custom field datetime | TIMESTAMP col | createdAt as TIMESTAMP | raw stored vs UTC (Date cols) | list filter (Date cols) | list filter (TIMESTAMP) | metrics day bucket |
|---|---|---|---|---|---|---|---|---|---|---|
| TZ=UTC, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ=America/Los_Angeles, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UTC day |
| TZ=Asia/Kolkata, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UTC day |
| TZ=UTC, time_zone +00:00, typeorm tz 'local' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, time_zone +00:00, typeorm tz 'local' | ❌ -1h | ❌ -1h | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ❌ -1h | ❌ +1h / +2h | ❌ misses 10/10 | ❌ misses 10/10 | same |
| TZ=America/Los_Angeles, time_zone +00:00, typeorm tz 'local' | ❌ +8h | ❌ +8h | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ❌ +8h | ❌ -8h / -7h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ=Asia/Kolkata, time_zone +00:00, typeorm tz 'local' | ❌ -5.5h | ❌ -5.5h | ✅ | ✅ | ✅ | ❌ -5.5h | ❌ +5.5h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ=UTC, time_zone Europe/Vienna, typeorm tz 'Z' | ❌ +1h | ❌ +1h | ✅ | ✅ | 💥 insert fails (utcInViennaGap) | ❌ +1h | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, time_zone Europe/Vienna, typeorm tz 'Z' | ❌ +1h | ❌ +1h | ✅ | ✅ | 💥 insert fails (utcInViennaGap) | ❌ +1h | ✅ | ✅ | ✅ | same |
| TZ=America/Los_Angeles, time_zone Europe/Vienna, typeorm tz 'Z' | ❌ +1h | ❌ +1h | ✅ | ✅ | 💥 insert fails (utcInViennaGap) | ❌ +1h | ✅ | ✅ | ✅ | UTC day |
| TZ=Asia/Kolkata, time_zone Europe/Vienna, typeorm tz 'Z' | ❌ +1h | ❌ +1h | ✅ | ✅ | 💥 insert fails (utcInViennaGap) | ❌ +1h | ✅ | ✅ | ✅ | UTC day |
| TZ=UTC, time_zone Europe/Vienna, typeorm tz 'local' | ❌ +1h | ❌ +1h | ✅ | ✅ | 💥 insert fails (utcInViennaGap) | ❌ +1h | ✅ | ✅ | ✅ | same |
| TZ=Europe/Vienna, time_zone Europe/Vienna, typeorm tz 'local' | ✅ | ✅ | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ❌ DST only: -1h (viennaFallBack2) | ✅ | ❌ +1h / +2h | ❌ misses 10/10 | ❌ misses 10/10 | same |
| TZ=America/Los_Angeles, time_zone Europe/Vienna, typeorm tz 'local' | ❌ +9h | ❌ +9h | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ❌ DST only: -1h (laFallBack2) | ❌ +9h | ❌ -8h / -7h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ=Asia/Kolkata, time_zone Europe/Vienna, typeorm tz 'local' | ❌ -4.5h | ❌ -4.5h | ✅ | ✅ | ✅ | ❌ -4.5h | ❌ +5.5h | ❌ misses 10/10 | ❌ misses 10/10 | Node-local day |
| TZ Europe/Vienna → UTC, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | same |
| TZ Europe/Vienna → UTC, time_zone +00:00, typeorm tz 'local' | ✅ | ✅ | ❌ +1h / +2h | ❌ +1h / +2h | ❌ +1h / +2h | ✅ | ❌ +1h / +2h | ❌ misses 10/10 | ❌ misses 10/10 | same |
| TZ UTC → America/Los_Angeles, time_zone +00:00, typeorm tz 'Z' | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UTC day |
| TZ UTC → America/Los_Angeles, time_zone +00:00, typeorm tz 'local' | ❌ +8h | ❌ +8h | ❌ +8h / +7h | ❌ +8h / +7h | ❌ +8h / +7h | ❌ +8h | ✅ | ✅ | ✅ | UTC day |
