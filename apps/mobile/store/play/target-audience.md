# Target audience and content: OnePeek 1.0

Owner: `release`. For **Play Console → Policy → App content → Target audience and content**. Google uses
this to decide whether the Families policy applies and how the app is shown in search.

| Question | Answer | Why |
| --- | --- | --- |
| Target age groups | **18 and over** only | OnePeek is a privacy tool for adults (teams sharing passwords, private conversations). It is not designed for children or teens, carries no child-directed content, and the web privacy policy states it is not intended for children under 13. Choosing any under-18 group would pull the app into the Families / Designed for Families policies (ads SDK certification, teacher-approved review, extra data rules) that do not fit an unmoderated end-to-end encrypted messenger. |
| Could the app unintentionally appeal to children? (store listing, icon, graphics) | **No** | Dark, text-led listing; no cartoon characters, games or child themes. If Google's reviewer disagrees, the listing is adjusted, never the audience answer. |
| Does the app contain any content or features that could be of interest to children? | No | |
| Is the app a "designed for families" app? | No | |
| Does the store listing include a privacy policy link? | Yes | `https://onepeek.io/privacy` |

## Consistency with the other declarations

- **Content rating** (`content-rating.md`) may come out at Teen / 12+ / 16+ because users exchange
  content. That is a content descriptor, not the target audience; 18+ as target audience is still correct
  and is what messaging apps with unmoderated communication normally declare.
- **Data safety** (`data-safety.md`): no children's data is collected; nothing about the app changes for
  under-18 users because none are targeted.
- **App Store** age rating: expected 13+ under Apple's 2025 scheme; Apple has no separate "target
  audience" field. Apple's "Made for Kids" is **No**.

## Age gating in the app

None. The app does not ask for a date of birth and does not need to: it targets adults, has no
age-restricted content of its own, and store-level age ratings handle discovery. If a future regulation
or a store policy requires age assurance for messaging apps, that is a product change (lead), not a
console answer.
