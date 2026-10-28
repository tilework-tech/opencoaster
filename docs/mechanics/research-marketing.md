# Research and Marketing

This note records the RCT2 behavior OpenCoaster implements for the Research and Development and Marketing windows. The [RCT2 manual](https://rct2.rctspace.com/rct2_manual.pdf) describes research funding, category focus, and marketing campaigns as player controls. Campaign costs and details are read from the in-game campaign list; the prices are represented as weekly charges.

## Research and Development

RCT2 research covers Transport Rides, Gentle Rides, Roller Coasters, Thrill Rides, Water Rides, Shops & Stalls, and Scenery & Themeing. The player chooses None, Minimum, Normal, or Maximum funding and selects the categories to prioritize. The monthly research costs are $0, $100, $200, and $400 respectively; the simulation pays these as four equal weekly charges, matching the game's four-week finance cadence. [Research funding reference](https://rct.fandom.com/wiki/Financial_Summary)

Each scenario supplies its own ordered invention list. The next invention is the first undiscovered item in that order whose category is selected. Funding adds work at the existing project rates; when an item finishes, the game unlocks it and carries excess work to the next eligible invention. The Research window shows the next item, progress, and the phase labels “Initial research,” “Designing,” and “Completing design.” The phase labels follow RCT2's staged development presentation; OpenCoaster divides its continuous work total into thirds for display and does not claim that those exact stage boundaries match the original game's internal thresholds. Category selection is the player-facing priority control; the scenario list supplies the order within selected categories.

Newly unlocked rides produce the RCT2-style “New ride/attraction now available” news item. The first snapshot seeds already available items without announcements, preserving the starter scenario's starting ride set from PR #162. The game's strings also establish the category labels and new-ride message wording. [RCT2 game string inventory](https://github-wiki-see.page/m/openrct2/openrct2/wiki/Strings-used-in-the-game)

## Marketing

Marketing has six campaign types, each available for one to six weeks. The weekly prices used by the game are:

| Campaign | Weekly cost | Guest effect |
| --- | ---: | --- |
| Free park-entry vouchers | $50 | Attracts arrivals who enter without paying the gate fee. |
| Park advertising | $350 | Raises park-wide guest arrivals without issuing a voucher. |
| Free ride vouchers | $50 | Attracts arrivals toward the selected ride and gives them a free-ride voucher for it. |
| Half-price park-entry vouchers | $50 | Attracts arrivals who pay half the gate fee. |
| Free food or drink vouchers | $50 | Attracts arrivals carrying a voucher for the selected food or drink stall. |
| Selected-ride advertising | $200 | Raises arrivals and sends them toward the selected ride without a voucher. |

The RCT2 manual says campaigns bring new guests to the park, lists six campaign choices, and lets the player choose a duration in weeks. [Manual, Research and Marketing](https://rct2.rctspace.com/rct2_manual.pdf#page=26) OpenRCT2 is used only as a behavior reference for the campaign attraction weights and voucher/target distinctions; its implementation is not copied. [OpenRCT2 Marketing reference](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/management/Marketing.cpp)

OpenCoaster converts the OpenRCT2 relative attraction weights into its existing arrival multiplier model. The multipliers are a project approximation, not a claim of exact vanilla RCT2 probability values. Entry vouchers affect the gate charge; ride and food vouchers are stored on guests and only apply to the selected target. Ride campaigns direct arriving guests to their selected open ride. Campaigns charge once per active week and stop after their selected duration.

## Sources and limits

- [RCT2 manual PDF](https://rct2.rctspace.com/rct2_manual.pdf), pages 50–51: campaign choices, week duration, guest-attraction purpose, research funding levels, and category focus.
- [RCT2 finance reference](https://rct.fandom.com/wiki/Financial_Summary): monthly research costs and their four weekly-quarter charges.
- [OpenRCT2 Research reference](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/management/Research.cpp) and [Marketing reference](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/management/Marketing.cpp): public behavior references, not proof that every detail matches vanilla RCT2.
- [RCT2 string inventory](https://github-wiki-see.page/m/openrct2/openrct2/wiki/Strings-used-in-the-game): category names and new-ride news text.
- The manual's extracted marketing screenshot text has inconsistent campaign prices across reproductions. The values above follow the RCT2/OpenRCT2 campaign price table and the task's hand-worked weekly amounts; treat the source screenshot as a UI reference rather than a price table.
