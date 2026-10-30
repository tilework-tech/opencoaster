# Shops and stalls: items, prices and purchases

What each stall sells, what the items cost and are worth, when guests buy, what a purchase does to the guest, and what the stall window shows. This implements gap #10 in [gap-audit.md](gap-audit.md). OpenRCT2 is used as a **behaviour reference only**: the numbers below were read from its published item table and purchase routine and re-expressed here; no code was copied. Where OpenCoaster differs from that behaviour, the difference is listed under [Deviations and assumptions](#deviations-and-assumptions).

Sources:

- Item table (cost, base/hot/cold value, default price, consumption time, discarded container): [`ShopItem.cpp`](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/ride/ShopItem.cpp), `rct2: 0x00982164` and `0x00982358`.
- Purchase decision: [`Guest.cpp`](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/entity/Guest.cpp), `GuestDecideAndBuyItem` (`rct2: 0x0069AF1E`).
- Eating and drinking: `Guest::updateConsumptionMotives` (`rct2: 0x0068FA89`); dropping empty containers: `Guest::updateWalking` (`rct2: 0x0069030A`); balloon release: `Guest::updateAnimationGroup` (`rct2: 0x0069B8CC`).
- Hot and cold thresholds: [`ClimateObject.cpp`](https://github.com/OpenRCT2/OpenRCT2/blob/develop/src/openrct2/object/ClimateObject.cpp) (`warmItemTempThreshold` 21, `coldItemTempThreshold` 11).
- Player-facing description: [OpenRCT2 shops and stalls](https://docs.openrct2.io/en/latest/playing/shops_and_stalls/index.html), [RCT2 manual](https://rct2.rctspace.com/rct2_manual.pdf).

## Items

All money is integer cents. "Value" is what a guest thinks the item is worth; the price a guest tolerates is measured from it. Code: [shop-items.ts](../../src/sim/rides/shop-items.ts), tests in [shop-items.test.ts](../../src/sim/rides/shop-items.test.ts).

| Item       | Kind     | Stock cost | Value (mild) | Value (warm, 21 C and up) | Value (cold, 11 C and down) | Start price | Eating time | Leaves        |
| ---------- | -------- | ---------: | -----------: | ------------------------: | --------------------------: | ----------: | ----------: | ------------- |
| Balloon    | souvenir |      $0.30 |        $1.40 |                     $1.40 |                       $1.40 |       $0.90 |           - | -             |
| Park Map   | souvenir |      $0.10 |        $0.70 |                     $0.70 |                       $0.80 |       $0.60 |           - | -             |
| Umbrella   | souvenir |      $2.00 |        $3.50 |                     $2.50 |                       $5.00 |       $2.50 |           - | -             |
| Drink      | drink    |      $0.30 |        $1.20 |                     $2.00 |                       $1.00 |       $1.20 |         100 | can           |
| Burger     | food     |      $0.50 |        $1.90 |                     $1.90 |                       $2.20 |       $1.50 |         150 | burger box    |
| Chips      | food     |      $0.40 |        $1.60 |                     $1.60 |                       $1.80 |       $1.50 |         120 | rubbish       |
| Ice Cream  | food     |      $0.40 |        $1.00 |                     $1.50 |                       $0.60 |       $0.90 |          60 | -             |
| Candyfloss | food     |      $0.30 |        $0.90 |                     $0.90 |                       $0.60 |       $0.80 |          50 | -             |
| Pizza      | food     |      $0.60 |        $2.10 |                     $2.10 |                       $2.50 |       $1.60 |         150 | rubbish       |
| Popcorn    | food     |      $0.50 |        $1.30 |                     $1.30 |                       $1.10 |       $1.20 |          75 | rubbish       |
| Hat        | souvenir |      $0.90 |        $2.70 |                     $3.20 |                       $2.40 |       $1.50 |           - | -             |
| T-Shirt    | souvenir |      $2.00 |        $3.70 |                     $3.70 |                       $3.70 |       $3.00 |           - | -             |

Not implemented: cuddly toys, hot dogs, on-ride photos, coffee, lemonade, the Asian-themed food set, sunglasses and other items from the full RCT2 table. They need stall types and art this PR does not add.

## What each stall sells

A stall sells up to two items; the first is priced by the ride price, the second by a second price. Ride types in [ride-types.ts](../../src/sim/rides/ride-types.ts).

| Stall (type id)          | First item | Second item |
| ------------------------ | ---------- | ----------- |
| Food Stall (5)           | Burger     | -           |
| Drink Stall (6)          | Drink      | -           |
| Information Kiosk (7)    | Park Map   | Umbrella    |
| Burger Stall (24)        | Burger     | -           |
| Chips Stall (25)         | Chips      | -           |
| Ice Cream Stall (26)     | Ice Cream  | -           |
| Candyfloss Stall (27)    | Candyfloss | -           |
| Balloon Stall (28)       | Balloon    | -           |
| Pizza Stall (29)         | Pizza      | -           |
| Popcorn Stall (30)       | Popcorn    | -           |
| Hat Stall (31)           | Hat        | -           |
| Souvenir Stall (32)      | T-Shirt    | -           |

The Food Stall is the starter's generic food stall and sells burgers. Toilets sell no items and keep their per-use fee. Chips, ice cream, candyfloss and balloon stalls are available from the start of every scenario; pizza, popcorn, hat and souvenir stalls are research inventions (shop category) after the burger stall. Build costs and the $3.10 fortnightly running cost for the new stalls are OpenCoaster choices; the source gives running cost only for the original food, drink and toilet types.

## When a guest buys

The checks follow `GuestDecideAndBuyItem`, in this order. Any failure means no sale.

1. **Already has it.** A guest buys at most one balloon, hat, T-shirt, umbrella or map.
2. **Nausea.** At nausea 145 or more a guest refuses food and drink.
3. **Rain.** In rain or storm nobody buys balloons, ice cream or candyfloss.
4. **Cold.** Below 12 C nobody buys ice cream.
5. **Hunger and thirst.** Food is bought only at hunger 75 or less, drink at thirst 75 or less (255 is full). Guests head for food or drink at that same threshold.
6. **Souvenir mood.** A souvenir (not a map, and not an umbrella in the rain) needs the guest to have taken at least 3 rides and `rand(0..127) + 115 <= happiness`.
7. **Cash.** The price must not exceed the guest's cash.
8. **Value.** With `value` the hot, mild or cold value for today's temperature: if the price is above the value, the excess (in tenths of a dollar) is halved for happiness 128 or more and halved again for 180 or more, and the guest refuses when it exceeds a draw of 0 to 7. An umbrella in the rain skips this check, as does a map for a lost guest.

A sale at or below value lifts happiness and its target by four per tenth of a dollar saved, counting at least eight tenths: `4 * max(8, floor((value - price) / 10))`, so 32 at least. A voucher skips checks 6 to 8 and the happiness lift. The flat happiness bump every shop sale used to give is gone for items: only a sale at or below value lifts the mood, as in the source. Toilets keep it.

A guest also checks the souvenir mood roll when choosing a souvenir stall, so a guest who would be refused on arrival does not walk there.

Guests choose a stall to walk to in this order: toilets, an umbrella from a kiosk in the rain, food or drink at the hunger or thirst threshold, a souvenir stall, then a ride. A guest with three rides behind them considers a souvenir stall at about one in 64 steps (an OpenCoaster choice; RCT2 guests decide as they pass an entrance). Only lost guests buy maps.

## What a purchase does

- **Money.** Food and drink post to `FoodDrinkSales` with the stock cost to `FoodDrinkStock`; souvenirs, maps and umbrellas post to `ShopSales` with the cost to `ShopStock`. Park rating formulas and scenario objectives are unchanged.
- **Eating.** Each 3 ticks of eating time is one step. A food step adds 7 hunger, removes 3 thirst and adds 2 toilet need; a drink step adds 7 thirst. Needs cap at 0 and 255. A burger (150 ticks, 50 steps) therefore fills the guest, removes 150 thirst and adds 100 toilet need. This applies to every food, including ice cream; a community guide says ice cream does not affect thirst, but the purchase routine does not special-case it.
- **Litter.** A guest holds the empty container (can, burger box or rubbish) and drops it on a footpath at about one in 51 of the litter checks made every 160 ticks (about once per 8,192 ticks, matching the source's 1 in 512 ticks times 1 in 16). A guest holding a container who steps onto a tile with a working bin that has room puts it in the bin instead (RCT2 walks the guest to the bin; here the guest uses a bin on the tile it is standing on, at a tile centre). The container litter adds to the generic background trash OpenCoaster already had, which has no RCT2 source.
- **Carried items.** Balloons, hats and (in rain) umbrellas are drawn on the guest; the guest window lists everything carried. A map is the existing lost-guest map.
- **Stall statistics.** Each stall counts sales and takings per item; profit is takings less stock cost times items sold.

## The stall window

The ride window's financial tab lists each item the stall sells with its own price control (the second price for a kiosk's umbrella), what guests think it is worth today (so the player sees the hot or cold value), items sold, sales and profit. Code: [stall-items.ts](../../src/ui/windows/stall-items.ts), tests in [stall-items.test.ts](../../src/ui/windows/stall-items.test.ts).

## Deviations and assumptions

- Eating is applied at the moment of purchase rather than over the eating time, so a guest never "hasn't finished" a previous item.
- Balloon release (RCT2: about 0.5% at each animation refresh) is not modelled: balloons are kept until the guest leaves. Balloons are drawn in one colour, hats and umbrellas in one colour each (RCT2 uses the stall's colour scheme). T-shirts are carried but not drawn.
- The souvenir urge (one in 64 steps once a guest has taken three rides) and the umbrella-only-in-rain rule are OpenCoaster choices.
- Hot, mild and cold values use the climate object's default thresholds (21 and 11); per-climate thresholds are not read.
- Stall popularity and satisfaction updates in the source are not modelled.
- New stall build costs, the guest-generation bonus (15, as for the existing food and drink stalls) and running costs are OpenCoaster values.
