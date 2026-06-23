Ниже — система **Battle Pass + Market + IAP-монетизация** для **Space Y** как Telegram Mini App / mobile F2P игры.

Главный принцип: **продавать не победу, а регулярную ценность вокруг сборки корабля**. В GDD уже правильно зафиксировано, что после боя игрок получает scrap, credits, blueprints, детали, материалы, редкие компоненты, косметику и опыт, но прямую силу продавать нежелательно, потому что игра строится вокруг PvP/соревнования сборок.  

---

# 1. Общая модель монетизации Space Y

Для Space Y я бы использовала такую структуру:

```text
Free Progression
- бесплатный battle pass;
- ежедневные и еженедельные задания;
- миссии;
- salvage;
- research;
- фракции;
- сезонные события.

Premium Monetization
- premium battle pass;
- premium+ battle pass;
- косметика;
- engine trails;
- эффекты запуска двигателей;
- слоты билдов;
- расширение склада;
- ускорение research;
- salvage choice;
- repair/recovery convenience;
- monthly supply card;
- event bundles.

Нельзя:
- продавать лучшую пушку напрямую;
- продавать абсолютную боевую силу;
- делать премиум-кабины обязательными;
- делать платный pass единственным способом получить функциональную деталь.
```

Для Telegram Mini App важно учитывать платёжную механику Telegram: цифровые товары и сервисы в ботах/Mini Apps продаются за **Telegram Stars**, а Telegram invoice можно отправлять в чаты, группы и каналы, включая inline-сценарии. Для Space Y это означает, что внешний платёжный слой лучше делать через Stars, а внутри игры можно использовать свою премиальную валюту, например **Y-Crystals**, как игровую единицу баланса. ([Telegram][1])

```text
Telegram Stars
= платёжный слой Telegram.

Y-Crystals
= внутриигровая премиальная валюта Space Y.

Credits
= обычная игровая валюта.

Scrap / Alloy / Data Shards / Engine Parts / Weapon Parts
= материалы, не основные валюты.
```

---

# 2. Battle Pass как “Season Operation”

В Space Y battle pass лучше назвать не просто Battle Pass, а:

```text
Season Operation
```

Примеры названий сезонов:

```text
Operation: Meteor Bloom
Operation: Pirate Eclipse
Operation: Deep Salvage
Operation: Solar Storm
Operation: Black Orbit
Operation: Drone Hive
Operation: Alien Signal
```

Battle pass в мобильных играх хорошо работает именно как сочетание времени, прогрессии, бесплатной и премиум-дорожки; GameRefinery отмечает распространённую структуру free/premium reward tracks, дополнительные premium-планы, co-op/guild-варианты и piggy bank-механики как способы усилить engagement и покупки. ([GameRefinery][2])

---

# 3. Длительность сезона

Для Telegram Mini App я бы не делала слишком длинный pass.

Оптимальная длительность:

```text
28 дней
```

Почему:

```text
- Telegram-игры часто потребляются короткими сессиями;
- 28 дней легко воспринимаются как “месячная операция”;
- можно делать 13 сезонов в год;
- игрок не устаёт от одной темы;
- легче тестировать экономику и офферы.
```

Альтернативно:

```text
35 дней
```

Если миссии и события будут требовать больше времени.

---

# 4. Количество уровней pass

Для первой версии:

```text
40 уровней
```

Позже:

```text
50 уровней + bonus levels
```

Почему не 100:

```text
100 уровней выглядят внушительно, но для Telegram Mini App это может ощущаться как тяжёлая обязанность.
40 уровней проще закрыть.
Игрок должен верить: “я реально успею пройти pass”.
```

---

# 5. Типы Battle Pass

Я бы сделал 3 варианта.

## 5.1. Free Operation Track

Бесплатная дорожка для всех игроков.

Даёт:

```text
- Credits;
- Scrap;
- Alloy;
- Data Shards;
- common/rare blueprint shards;
- repair kits;
- insurance coupons;
- common cosmetics;
- small Y-Crystals;
- event tokens;
- salvage scanner charges;
- basic decals;
- season badge.
```

Цель free track:

```text
1. Игрок должен чувствовать, что сезон полезен даже без оплаты.
2. Free игрок должен регулярно возвращаться.
3. Free track должен показывать ценность premium track.
```

---

## 5.2. Premium Operation Pass

Платный pass.

Даёт всё из free track + premium rewards.

Даёт:

```text
- больше Y-Crystals;
- premium cosmetics;
- animated engine trails;
- premium decals;
- extra salvage choice tokens;
- research accelerators;
- recovery tokens;
- rare blueprint shards;
- build slot voucher;
- inventory expansion voucher;
- exclusive season ship skin;
- cosmetic cabin skin;
- premium season badge;
- better pass completion chest.
```

Цель premium pass:

```text
Это лучшая покупка по value.
Если игрок готов заплатить один раз в месяц, он должен покупать именно premium pass.
```

---

## 5.3. Admiral Operation Pass

Премиум+ вариант.

Даёт:

```text
- Premium Operation Pass;
- +10 уровней pass сразу;
- уникальный animated banner;
- 1 эксклюзивный engine ignition VFX;
- 1 Battle Archive Token;
- 1 Emergency Recovery Token;
- 1 extra build slot;
- +10% season XP boost;
- premium profile frame.
```

Важно: **Admiral не должен давать уникальную боевую силу**.

Он даёт:

```text
- статус;
- ускорение;
- удобство;
- доступ к архивной косметике;
- больше шансов закрыть pass.
```

---

# 6. Рекомендованные цены

Для Telegram Mini App цены лучше указывать в Stars, а не в долларах/евро. Реальные цены лучше тестировать по регионам.

Стартовая лестница:

```text
Premium Operation Pass
599–799 Stars

Admiral Operation Pass
1199–1499 Stars

Monthly Supply Dock
299–499 Stars

Starter Engineer Pack
199–299 Stars

Cosmetic Pack
199–999 Stars

Build Slot Pack
299–599 Stars

Emergency Recovery Bundle
199–499 Stars
```

Для Telegram Mini App особенно полезно, что invoice с цифровым товаром может быть отправлен не только лично пользователю, но и в чаты/каналы, а пользователи могут оплачивать товары через встроенный Telegram-интерфейс без ввода личных данных вроде адреса или карты внутри вашей Mini App. ([Telegram][1])

---

# 7. Как игрок получает Season XP

Season XP не должен зависеть только от побед. Иначе слабые игроки будут выпадать.

Источники XP:

```text
Daily Missions
- завершить 2 контракта;
- собрать 200 Scrap;
- отремонтировать 3 детали;
- победить 20 дронов;
- отправить rescue drone другу;
- сделать Module Resonance.

Weekly Missions
- пройти 10 контрактов;
- закрыть 3 разные категории миссий;
- завершить 1 Squadron Contract;
- собрать 5 blueprint shards;
- нанести 50 000 урона;
- добыть 100 Alloy в mining missions.

Season Challenges
- победить season boss;
- собрать сезонную коллекцию панелей;
- открыть сезонный blueprint;
- завершить 5 Red Contracts;
- выиграть 10 Ghost Duels.

Social XP
- помочь по SOS Beacon;
- закрыть Connector Request;
- участвовать в Shared Salvage Wreck;
- занять crew seat у друга;
- пригласить активного пилота.
```

Важно:

```text
Игрок должен получать XP за разные стили игры:
боевой,
шахтёрский,
salvage,
escort,
социальный,
research.
```

Так pass не превращается в “фарми только один режим”.

---

# 8. Weekly XP Cap

Нужен мягкий weekly cap.

```text
Base weekly XP cap: 10 уровней pass в неделю.
Catch-up XP: если игрок пропустил неделю, он получает +50% XP до догоняющего лимита.
```

Зачем:

```text
- whale не проходит pass за 1 день;
- casual player не чувствует, что отстал навсегда;
- сезон живёт весь месяц;
- late joiner всё ещё может купить premium pass.
```

В battle pass-дизайне важно балансировать время и деньги: слишком большой grind ощущается несправедливым, а слишком быстрый прогресс убивает engagement; современные pass-системы также используют catch-up и currency-based выбор наград, чтобы игроки получали больше контроля. ([gamemakers.com][3])

---

# 9. Главное правило functional rewards

В Space Y можно давать через pass функциональные вещи, но только аккуратно.

Разрешено:

```text
- blueprint shards;
- временный loaner module;
- common/rare детали;
- материалы для крафта;
- research ускорение;
- extra salvage choice;
- insurance coupons;
- repair kits;
- early access к чертежу, который позже станет доступен всем.
```

Нежелательно:

```text
- уникальная премиумная пушка навсегда;
- лучшая кабина только в premium pass;
- legendary panel, недоступная free игрокам;
- прямой +30% DPS за premium.
```

Лучшее правило:

```text
Если функциональный предмет появляется в premium pass,
то free игрок тоже должен получить путь к нему через:
- research;
- faction reputation;
- event shop;
- blueprint shards;
- boss drop;
- salvage.
```

---

# 10. Пример Battle Pass на 40 уровней

Сезон:

```text
Operation: Meteor Bloom
Тема: бурение метеоритов, industrial panels, heat sinks, mining rigs, glowing asteroid cosmetics.
Длительность: 28 дней.
Уровней: 40.
```

| Level | Free Track                           | Premium Track                            |
| ----: | ------------------------------------ | ---------------------------------------- |
|     1 | Season badge: Meteor Rookie          | Premium skin: Meteor Hull Lines          |
|     2 | 500 Credits                          | 100 Y-Crystals                           |
|     3 | Scrap x80                            | Alloy Plates x60                         |
|     4 | Data Shards x20                      | Research Accelerator 1h                  |
|     5 | Blueprint Shards: Basic Drill x3     | Blueprint Shards: Thermal Drill x5       |
|     6 | Repair Kit x1                        | Repair Kit x3                            |
|     7 | Common Salvage Crate                 | Rare Salvage Crate                       |
|     8 | Credits x700                         | Y-Crystals x100                          |
|     9 | Alloy Plates x40                     | Heat Sink Parts x40                      |
|    10 | Cosmetic decal: Asteroid Mark        | Animated decal: Cracked Star             |
|    11 | Scrap x120                           | Engine Parts x50                         |
|    12 | Data Shards x30                      | Research Accelerator 2h                  |
|    13 | Insurance Coupon: Common             | Insurance Coupon: Rare                   |
|    14 | Credits x900                         | Y-Crystals x100                          |
|    15 | Blueprint Shards: Heat Sink Panel x4 | Blueprint Shards: Thermal Drill x8       |
|    16 | Salvage Scanner Charge x1            | Salvage Choice Token x1                  |
|    17 | Alloy Plates x60                     | Industrial Connector Dust x30            |
|    18 | Common Panel Crate                   | Rare Panel Crate                         |
|    19 | Credits x1000                        | Repair Drone Charge x2                   |
|    20 | Free cosmetic: Grey Meteor Paint     | Premium cosmetic: Glowing Meteor Paint   |
|    21 | Data Shards x40                      | Research Accelerator 3h                  |
|    22 | Scrap x150                           | Alloy Plates x100                        |
|    23 | Blueprint Shards: Cargo Panel x4     | Blueprint Shards: Industrial Adapter x5  |
|    24 | Repair Kit x2                        | Full Repair Voucher x1                   |
|    25 | Common Salvage Crate                 | Epic Shard Crate                         |
|    26 | Credits x1200                        | Y-Crystals x150                          |
|    27 | Insurance Coupon: Rare               | Emergency Recovery Fragment x1           |
|    28 | Alloy Plates x80                     | Salvage Choice Token x2                  |
|    29 | Data Shards x50                      | Research Accelerator 4h                  |
|    30 | Season cabin decal                   | Premium cabin skin: Utility Cabin Meteor |
|    31 | Scrap x200                           | Engine Parts x100                        |
|    32 | Credits x1500                        | Y-Crystals x150                          |
|    33 | Blueprint Shards: Thermal Drill x4   | Blueprint Shards: Thermal Drill x10      |
|    34 | Repair Kit x3                        | Rare Insurance Pack                      |
|    35 | Rare Salvage Crate                   | Prototype Fragment: Overclock Drill x1   |
|    36 | Data Shards x75                      | Research Accelerator 6h                  |
|    37 | Alloy Plates x100                    | Industrial Connector Cache               |
|    38 | Season Event Tokens x200             | Season Event Tokens x500                 |
|    39 | Premium Currency: Y-Crystals x50     | Y-Crystals x250                          |
|    40 | Final Free Chest                     | Final Premium Chest + Engine Trail       |

Final Free Chest:

```text
- Credits;
- Scrap;
- Data Shards;
- 1 random rare blueprint shard;
- small chance for rare cosmetic decal.
```

Final Premium Chest:

```text
- Y-Crystals;
- Rare/Epic blueprint shards;
- Emergency Recovery Token;
- exclusive Meteor Bloom engine trail;
- premium profile frame;
- Battle Archive Token.
```

---

# 11. Bonus Levels после 40

После завершения pass игрок не должен терять мотивацию.

После 40 уровня открывается:

```text
Bonus Loop
```

Каждые 5000 Season XP игрок получает:

```text
Bonus Supply Crate
```

Содержимое:

```text
- Credits;
- Scrap;
- Data Shards;
- repair kits;
- event tokens;
- tiny chance for cosmetic shard.
```

Premium игрок получает:

```text
Bonus Supply Crate+
```

Содержимое чуть лучше, но без эксклюзивной силы.

---

# 12. Battle Archive

Чтобы FOMO не был слишком токсичным, нужен **Battle Archive**.

```text
Battle Archive = магазин старых косметических наград из прошлых сезонов.
```

Получение Archive Tokens:

```text
- Admiral Pass;
- завершение Premium Pass;
- редкие event rewards;
- anniversary events.
```

Что можно купить:

```text
- старые скины панелей;
- engine trails;
- profile frames;
- decals;
- hangar themes;
- старые animated banners.
```

Что нельзя:

```text
- старые функциональные предметы как exclusive power.
```

GameRefinery приводит пример archive store для бывших battle pass-наград как способ вернуть старые награды и одновременно усилить ценность дорогого pass-варианта. ([GameRefinery][2])

---

# 13. Battle Pass для free игроков

Free track должен быть достаточно ценным.

Цель free player:

```text
Игрок без оплаты должен:
- стабильно ремонтироваться;
- крафтить common/rare детали;
- изучать чертежи;
- получать немного премиальной валюты;
- участвовать в событиях;
- закрывать сезонные цели;
- видеть, что premium track реально вкусный.
```

Рекомендуемая структура free rewards за сезон:

```text
Credits:
10 000–18 000

Scrap:
1500–3000

Materials:
600–1200 суммарно

Data Shards:
300–600

Blueprint Shards:
30–60

Repair Kits:
8–15

Insurance Coupons:
3–6

Y-Crystals:
150–300

Cosmetics:
2–4 простых предмета

Final Chest:
1 редкий полезный reward
```

Free игрок не должен чувствовать себя “нищим”. Он должен чувствовать:

```text
Я играю бесплатно, но прогрессирую.
Premium просто делает сезон вкуснее и красивее.
```

---

# 14. Battle Pass для premium игроков

Premium track должен ощущаться как:

```text
лучшая покупка месяца
```

Рекомендуемая структура premium rewards за сезон:

```text
Y-Crystals:
700–1200

Credits:
20 000–35 000

Materials:
2000–4000

Data Shards:
800–1500

Blueprint Shards:
80–150

Research Accelerators:
15–30 часов суммарно

Repair / Insurance:
10–20 предметов

Salvage Choice Tokens:
4–8

Emergency Recovery:
1 полноценный token или 3–5 fragments

Build Slot Voucher:
1 раз в 2–3 сезона

Inventory Expansion:
1 раз в 2–3 сезона

Premium Cosmetics:
5–10 предметов

Exclusive Season Set:
1 полный visual set
```

---

# 15. Premium Battle Pass не должен окупать сам себя полностью

Некоторые игры дают достаточно премиальной валюты, чтобы купить следующий pass. Это повышает лояльность, но уменьшает доход. Для Space Y на старте лучше сделать частичный cashback:

```text
Premium Pass стоит условно 799 Stars.
Внутри даёт Y-Crystals на 40–70% ценности следующего pass.
```

Почему:

```text
- игрок чувствует высокую ценность;
- но экономика не превращается в “один раз купил и всегда бесплатно”;
- можно тестировать retention и конверсию.
```

Позже можно сделать:

```text
Если игрок закрыл 100% pass:
- получает дополнительный discount token на следующий pass.
```

Это лучше, чем полный cashback.

---

# 16. Premium Pass purchase timing

Нужно разрешить покупать pass в любой момент сезона и забирать прошлые награды.

```text
Игрок прошёл 23 уровня бесплатно.
Покупает Premium Pass.
Сразу получает все premium rewards за уровни 1–23.
```

Это очень сильная механика конверсии:

```text
Игрок сначала играет.
Видит накопленную ценность.
Потом покупает.
```

На экране pass нужно показывать:

```text
Unlock Premium now and claim:
- 600 Y-Crystals
- 3 Rare Crates
- 2 Research Accelerators
- Meteor Hull Skin
- 1 Salvage Choice Token
```

Это работает лучше, чем просто “купи pass”.

---

# 17. Pass как часть Telegram virality

Так как Space Y — Telegram Mini App, pass должен давать social missions.

Примеры:

```text
Daily:
- Help 1 SOS Beacon.
- Open 1 shared wreck.
- Send 1 repair drone.
- Complete 1 Ghost Duel.

Weekly:
- Complete 3 Squadron tasks.
- Finish 2 Module Resonances.
- Join 1 Group Sector Contract.
- Invite 1 active pilot who completes first mission.
```

Premium track может давать:

```text
- больше social reward tokens;
- premium profile frame для чата;
- animated share card;
- кастомную карточку корабля;
- extra Ghost Duel reward chest.
```

Но нельзя делать так:

```text
Без premium ты не можешь помогать друзьям.
```

---

# 18. Market: структура рынка Space Y

Рынок должен быть не одним магазином, а системой “доков”.

```text
1. Daily Market
2. Salvage Bay
3. Faction Docks
4. Research Lab
5. Cosmetic Dock
6. Premium Dock
7. Emergency Services
8. Squadron Exchange
9. Event Shop
10. Battle Archive
```

---

# 19. Daily Market

Обычный рынок за Credits.

Продаёт:

```text
- common panels;
- common elements;
- базовые двигатели;
- базовые shield/repair модули;
- дешёвые adapter panels;
- repair kits;
- insurance coupons;
- random blueprint shards.
```

Ротация:

```text
- обновление каждые 6 часов;
- 6 бесплатных слотов;
- 2 locked слота открываются за просмотр reward ad или premium;
- reroll за Credits;
- один бесплатный reroll в день.
```

Пример офферов:

```text
Basic Ion Engine
Price: 450 Credits

Light Hull Panel x4
Price: 320 Credits

Common Repair Kit x2
Price: 180 Credits

Basic Drill Blueprint Shard x3
Price: 600 Credits

Adapter Panel Y-A to Y-C
Price: 900 Credits
```

---

# 20. Salvage Bay

Магазин повреждённых деталей.

Продаёт:

```text
- damaged rare parts;
- broken epic parts;
- панели с неудобными connector IDs;
- дешёвые, но повреждённые двигатели;
- salvage crates;
- детали, которые надо ремонтировать.
```

Пример:

```text
Damaged Plasma Thruster
Rarity: Rare
Condition: 41%
Price: 1200 Credits
Repair to 100%: 900 Credits

Broken Flak Turret
Rarity: Rare
Condition: 0%
Price: 700 Credits
Research value: +8 Flak Blueprint Progress
```

Почему это сильная механика:

```text
Free игрок может получить редкую штуку дешевле.
Premium игрок может быстрее восстановить её.
Оба чувствуют “я нашла выгодную находку”.
```

---

# 21. Faction Docks

Фракционные магазины.

Фракции:

```text
Miner Guild
- drills;
- heat sinks;
- cargo panels;
- industrial connectors.

Courier Union
- light engines;
- stabilizers;
- low-mass panels;
- delivery modules.

Security Fleet
- shields;
- point-defense;
- armor;
- repair beams.

Black Orbit
- EMP;
- stealth panels;
- smuggler cargo;
- decoys.

Alien Research Lab
- prototype/alien fragments;
- strange connectors;
- gravity modules.
```

Покупка:

```text
Credits + Reputation
```

Пример:

```text
Miner Guild Rank 3:
Thermal Drill Blueprint Shard x5
Price: 1500 Credits + 80 Miner Rep

Security Fleet Rank 2:
Point Defense Array
Price: 2200 Credits + 120 Security Rep
```

Это не pay-to-win, потому что игрок должен играть в соответствующие миссии.

---

# 22. Research Lab Market

Рынок исследований.

Продаёт не детали, а прогресс:

```text
- research queue slot;
- data shard packs;
- research accelerators;
- blueprint focusing;
- technology scanner;
- duplicate conversion.
```

Пример:

```text
Research Accelerator 1h
Price: 80 Y-Crystals

Blueprint Focus: Mining
Effect: next 5 blueprint drops have +30% chance to be mining-related
Price: 120 Y-Crystals

Data Shards Pack
Price: 250 Y-Crystals
```

Важно:

```text
Research Accelerator ускоряет.
Он не открывает эксклюзивную силу сам по себе.
```

---

# 23. Cosmetic Dock

Самый безопасный и важный магазин.

Space Y идеально подходит для косметики, потому что корабль собирается руками игрока, детали видны в бою, двигатели светятся именно там, где установлены, а повреждения/эффекты появляются на конкретных частях корабля.  

Категории:

```text
Hull Paints
- цвета корпуса;
- материалы;
- паттерны;
- faction paints.

Panel Skins
- visual variant для панелей;
- carbon;
- damaged pirate;
- neon;
- alien organic.

Engine Trails
- ion blue;
- plasma violet;
- solar orange;
- dark matter;
- alien green.

Ignition VFX
- красивый старт двигателя;
- flare;
- shockwave;
- spark burst.

Weapon VFX
- цвет лазера;
- стиль railgun beam;
- missile smoke;
- EMP wave style.

Explosion VFX
- reactor bloom;
- plasma burst;
- black hole pop;
- confetti joke effect для событий.

Profile
- avatar frame;
- pilot banner;
- season badge;
- ship card background.

Hangar Themes
- mining station;
- pirate dock;
- alien lab;
- corporate clean hangar.
```

Примеры офферов:

```text
Meteor Bloom Hull Pack
- 3 hull paints
- 2 decals
- 1 profile banner
Price: 399 Stars

Ion Trail Pack
- 3 engine trails
- 1 ignition flash
Price: 299 Stars

Black Orbit Stealth Set
- matte black hull
- red cockpit glow
- dark smoke trail
- profile frame
Price: 799 Stars
```

---

# 24. Premium Dock

Главный магазин платных товаров.

Категории:

```text
- Premium Operation Pass;
- Admiral Operation Pass;
- Y-Crystals packs;
- Monthly Supply Dock;
- build slots;
- inventory expansion;
- research accelerators;
- salvage choice tokens;
- recovery tokens;
- cosmetic bundles;
- event tickets.
```

Пример главного экрана Premium Dock:

```text
Featured:
1. Operation Pass
2. Admiral Pass
3. Meteor Bloom Cosmetic Pack

Best Value:
4. Monthly Supply Dock
5. Y-Crystals Large Pack

Utility:
6. Build Slot +1
7. Inventory Expansion +25
8. Salvage Choice Token x5
9. Research Accelerator Pack
10. Emergency Recovery Bundle
```

---

# 25. Emergency Services

Это магазин для моментов после поражения.

Но его нужно делать осторожно, чтобы не было ощущения “игра сломала мне корабль, чтобы продать ремонт”.

Офферы:

```text
Emergency Recovery Token
- восстановить одну потерянную деталь;
- не работает на hardcore-only destroyed items;
- имеет лимит использования.

Insurance Bundle
- 3 rare insurance coupons;
- 1 epic insurance coupon.

Repair Drone Pack
- снижает repair cost;
- ускоряет repair;
- может быть получен и бесплатно.

Salvage Choice Token
- позволяет выбрать +1 предмет после миссии.

Loaner Contract Tool
- временный бур / тяговый луч / scanner на 1 миссию.
```

Контекстный оффер после поражения:

```text
Your Rare Plasma Engine was lost.
Options:
1. Recraft from blueprint.
2. Wait for Recovery Drone.
3. Use Emergency Recovery Token.
4. Ask friends via SOS.
```

Покупка должна быть **одной из опций**, а не единственным выходом.

---

# 26. Squadron Exchange

Групповой рынок для Telegram-чата / Squadron.

Продаёт за Squadron Tokens:

```text
- group banners;
- station cosmetics;
- group boost на Credits;
- group repair discount;
- group contract keys;
- visual chat badges;
- sector map skins.
```

Нельзя:

```text
- передавать rare/legendary детали между игроками напрямую;
- покупать боевую доминацию для всей группы.
```

---

# 27. Event Shop

Каждый сезон имеет event currency:

```text
Meteor Tokens
Pirate Marks
Alien Samples
Solar Coins
```

Event Shop продаёт:

```text
- сезонную косметику;
- blueprint shards;
- materials;
- event crates;
- profile badges;
- сезонные panels;
- Battle Archive fragments.
```

Правило:

```text
Free игрок должен успевать купить 1–2 ценные вещи.
Premium игрок может купить больше.
```

---

# 28. Battle Archive Shop

Магазин старых сезонных косметик.

Валюта:

```text
Battle Archive Tokens
```

Товары:

```text
- old engine trails;
- old hull skins;
- old decals;
- old profile banners;
- old hangar themes.
```

Не продавать:

```text
- exclusive функциональные детали, которые дают преимущество.
```

---

# 29. Набор сильных офферов для рынка

## 29.1. First Purchase: Rookie Engineer Pack

Один раз на аккаунт.

```text
Price: 199–299 Stars

Contains:
- 500 Y-Crystals
- 5000 Credits
- Repair Kit x5
- Salvage Choice Token x1
- Basic Hull Paint
- Profile Frame: Rookie Engineer
```

Задача:

```text
сломать барьер первой покупки.
```

---

## 29.2. Starter Shipyard Pack

```text
Price: 299–499 Stars

Contains:
- Build Slot +1
- Inventory +20
- Research Accelerator 3h
- Rare Blueprint Shards x10
- Starter Cosmetic Decal Pack
```

Задача:

```text
дать удобство игрокам, которым понравилась сборка кораблей.
```

---

## 29.3. Mining Contract Pack

Контекстный pack для игроков, которые начали mining-миссии.

```text
Contains:
- Thermal Drill Blueprint Shards
- Heat Sink Parts
- Alloy Plates
- Research Accelerator
- Mining Hull Paint
```

Важно:

```text
Не продавать готовый лучший бур.
Продавать путь к mining-билду.
```

---

## 29.4. Escort Defender Pack

```text
Contains:
- Shield Parts
- Point Defense Blueprint Shards
- Repair Kits
- Security Fleet Decal
- Insurance Coupon x2
```

---

## 29.5. Salvage Hunter Pack

```text
Contains:
- Salvage Choice Token x5
- Scanner Charges x5
- Data Shards
- Black Market Decal
- Inventory Expansion +10
```

---

## 29.6. Build Slot Pack

Один из лучших товаров для Space Y.

```text
Price: 299–599 Stars

Contains:
- Build Slot +1
- Build Card Background
- Ship Nameplate
```

Почему это сильный товар:

```text
Игра требует разных сборок:
- mining;
- escort;
- pirate hunter;
- cargo;
- rescue;
- Ghost Duel.
```

Слот билдов — это не сила в бою, а удобство.

---

## 29.7. Inventory Expansion

```text
Small Expansion:
+25 item slots

Medium Expansion:
+75 item slots

Large Expansion:
+200 item slots + sorting tabs
```

Важно:

```text
Не делать базовый инвентарь слишком маленьким.
Расширение должно быть удобством, а не болью.
```

---

## 29.8. Monthly Supply Dock

Месячная карта.

```text
Price: 299–499 Stars

Instant:
- 300 Y-Crystals
- profile badge

Daily for 30 days:
- 60 Y-Crystals
- 1 Repair Kit
- 1 small Credits drop
```

Задача:

```text
привычная recurring-value покупка для low/mid spender.
```

Не делать:

```text
- огромный боевой бонус;
- обязательный VIP.
```

---

## 29.9. Black Box Piggy Bank

Очень сильная механика.

Как работает:

```text
Игрок проходит миссии.
Часть заработанных Credits “дублируется” в Black Box.
Когда Black Box заполнен, его можно открыть за Stars.
```

Пример:

```text
Black Box contains:
- 20 000 Credits
- 300 Y-Crystals
- 5 Rare Blueprint Shards
- 1 Cosmetic Decal

Unlock: 299 Stars
```

Почему работает:

```text
Игрок сам “заработал” содержимое.
Покупка ощущается как разблокировка уже накопленной ценности.
```

GameRefinery отдельно упоминает piggy bank как механику, которая может усиливать battle pass и конвертировать non-payers через привлекательное накопленное предложение. ([GameRefinery][2])

---

## 29.10. Mission Failure Recovery Offer

Только после провала миссии.

```text
You almost recovered your Rare Flak Turret.
Complete recovery?

Offer:
- Emergency Recovery Fragment x3
- Repair Kit x5
- Insurance Coupon x2
- 100 Y-Crystals
```

Правило честности:

```text
Показывать не чаще 1 раза в день.
Не делать после каждой смерти.
Всегда оставлять free alternative:
- SOS Beacon;
- craft from blueprint;
- wait recovery drone;
- play Green Contract.
```

---

## 29.11. Season Finish Offer

За 3–5 дней до конца сезона.

```text
You are 6 levels away from completing Operation.
Offer:
- XP Boost 2x for 48h
- 3 Weekly Mission Refresh Tokens
- 1 Premium Chest
```

Лучше продавать **XP boost**, а не просто уровни. GameMakers отмечает, что catch-up и XP boosts часто ощущаются лучше, чем прямые level skips. ([gamemakers.com][3])

---

# 30. Самые сильные механики покупок в мобильном гейминге

Сейчас мобильный рынок продолжает расти через углубление монетизации: Sensor Tower отмечал рост mobile gaming IAP revenue на 4% за 2024 год к 2023, а Newzoo сообщил, что mobile revenue в 2025 достиг $113.3B и рос быстрее ожиданий, несмотря на снижение глобальных downloads. Это означает, что для Space Y важнее не просто “много установок”, а удержание, LiveOps, регулярные офферы и глубокая экономика. ([Sensor Tower][4]) ([Newzoo][5])

---

## 30.1. Battle Pass

Почему покупают:

```text
- понятная ценность;
- много наград за одну покупку;
- ограниченный сезон;
- ощущение прогресса;
- можно сначала накопить уровни, потом купить premium;
- игрок видит, что именно получит.
```

Для Space Y:

```text
Premium Operation Pass должен быть основным товаром месяца.
```

Лучшие награды:

```text
- косметика;
- build slot;
- salvage choice;
- research accelerators;
- Y-Crystals;
- repair/recovery convenience;
- blueprint shards.
```

---

## 30.2. Starter Pack / First Purchase

Почему покупают:

```text
- низкая цена;
- огромная perceived value;
- снимает страх первой оплаты;
- игрок получает быстрый старт;
- хорошо работает после первой удачной игровой сессии.
```

Для Space Y:

```text
Rookie Engineer Pack
```

Показывать после:

```text
- игрок прошёл 3 миссии;
- собрал второй корабль;
- впервые отремонтировал деталь;
- открыл первый blueprint.
```

---

## 30.3. Contextual Offers

Покупка появляется в момент, когда игрок понимает её ценность.

Примеры:

```text
Игрок провалил mining-миссию:
→ Mining Support Pack.

Игроку не хватает build slot:
→ Build Slot Offer.

Игрок потерял редкий элемент:
→ Recovery Offer.

Игрок часто делает Ghost Duel:
→ Arena Cosmetic Pack.

Игрок занимается salvage:
→ Salvage Hunter Pack.
```

Почему работает:

```text
Оффер не случайный.
Он отвечает на конкретную боль или желание игрока.
```

---

## 30.4. Cosmetics / Identity

Почему покупают:

```text
- игрок хочет отличаться;
- хочет показать корабль в чате;
- хочет красивый engine trail;
- хочет статус;
- хочет, чтобы build card выглядел круто.
```

Для Space Y это особенно сильный слой, потому что корабль — это личное творение игрока. Визуальный стиль GDD уже делает упор на premium sci-fi, тёмный металл, неоновые акценты, читаемые силуэты, дорогой UI и эффектные бои. 

Лучшие cosmetic товары:

```text
- engine trails;
- ignition VFX;
- hull paints;
- panel skins;
- cockpit glow;
- decals;
- explosion VFX;
- ship card background;
- hangar themes.
```

---

## 30.5. Convenience Purchases

Почему покупают:

```text
- не хочется вручную перестраивать корабли;
- не хватает места;
- хочется быстрее тестировать билды;
- хочется сохранить mining/escort/combat сборки отдельно.
```

Для Space Y:

```text
- build slots;
- inventory expansion;
- sorting tabs;
- saved loadouts;
- blueprint tracking;
- auto-repair preset;
- mission preparation checklist.
```

Это очень хорошая монетизация, потому что она не ломает баланс.

---

## 30.6. Time Saving

Почему покупают:

```text
- игрок уже решил, что хочет предмет;
- не хочет ждать research;
- не хочет долго фармить материалы;
- хочет быстрее попробовать новый билд.
```

Для Space Y:

```text
- research accelerators;
- material packs;
- blueprint focus;
- repair speedups;
- extra salvage choice.
```

Нельзя:

```text
- продавать мгновенное открытие лучшего оружия;
- продавать бесконечные улучшения.
```

---

## 30.7. Loss Recovery

Почему покупают:

```text
- игрок эмоционально привязан к детали;
- потеря произошла только что;
- есть желание “спасти” модуль;
- покупка кажется восстановлением, а не донатом.
```

Для Space Y это одна из самых сильных механик, потому что панели и элементы могут отваливаться в бою, а в будущем повреждение отдельных частей даст огромную глубину: уничтоженная пушка перестаёт стрелять, двигатель перестаёт давать тягу, реактор может взорваться, щит отключается, броня отваливается, и корабль меняет управление. 

Но важно:

```text
Потеря не должна быть ловушкой для продажи recovery.
```

Правильная модель:

```text
Free options:
- recovery drone;
- SOS Beacon;
- craft from blueprint;
- Green Contract фарм;
- repair with Credits.

Premium options:
- Emergency Recovery Token;
- premium insurance;
- extra salvage choice.
```

---

## 30.8. Piggy Bank

Почему покупают:

```text
- банк заполняется действиями игрока;
- игрок чувствует, что это уже его награда;
- цена выглядит выгодной;
- покупка часто происходит у non-payer.
```

Для Space Y:

```text
Black Box Vault
```

Заполняется:

```text
- завершением миссий;
- спасением чужих деталей;
- salvage;
- research progress;
- weekly goals.
```

Открывается за Stars.

---

## 30.9. Collection Completion

Почему покупают:

```text
- игроку не хватает последнего элемента коллекции;
- хочется закрыть set;
- set даёт визуальный статус;
- коллекция создаёт долгосрочную цель.
```

Для Space Y:

```text
- полные наборы hull skins;
- connector families;
- faction decals;
- engine trail collections;
- сезонные ship card sets;
- cosmetic badges за полные коллекции.
```

Функциональные коллекции должны давать мягкие бонусы:

```text
- discount на ремонт;
- extra cosmetic variant;
- title;
- небольшой research discount.
```

Не давать:

```text
+20% урона за полный premium set.
```

---

## 30.10. Gacha / Loot Boxes

Это сильная, но опасная механика.

Почему покупают:

```text
- случайность;
- шанс получить редкое;
- эмоция открытия;
- коллекционирование;
- variable reward.
```

Но для Space Y я бы не строила монетизацию вокруг платных боевых loot boxes.

Если делать crates:

```text
Free Salvage Crates
- можно получать за игру;
- могут содержать детали и материалы.

Paid Cosmetic Crates
- только косметика;
- прозрачные шансы.

Faction Crates
- за reputation/event tokens;
- не за прямые деньги.
```

Для платных случайных предметов нужно раскрывать шансы: App Store требует раскрывать odds для loot boxes и других механизмов покупки случайных виртуальных предметов до покупки, Google Play также требует заранее и рядом с покупкой раскрывать odds для randomised virtual items. ([Apple Developer][6]) ([Справка Google][7])

Мой вывод:

```text
Для Space Y платная random-сила — плохо.
Платная random-косметика — допустимо, если раскрыты шансы.
Лучше продавать прозрачные bundles.
```

---

## 30.11. Limited-Time Bundles / LiveOps

Почему покупают:

```text
- ограниченность по времени;
- тема события;
- игрок не хочет упустить красивый set;
- предложение связано с текущим gameplay.
```

Для Space Y:

```text
Meteor Week Bundle
Pirate Eclipse Bundle
Drone Hive Defense Bundle
Solar Storm Survival Pack
Alien Signal Cosmetic Set
```

Современные mobile monetization-подходы сильно завязаны на LiveOps: события, сезонные офферы, rotating content, event rewards и A/B тестирование помогают удержанию и LTV. ([Galaxy4Games][8])

---

## 30.12. Rewarded Ads

Почему работает:

```text
- free игрок получает ценность;
- не нужно платить;
- игрок сам выбирает смотреть или нет;
- можно мягко монетизировать non-payers.
```

Для Space Y:

```text
Rewarded ad options:
- +1 salvage choice;
- ускорить repair на 10 минут;
- daily repair kit;
- extra shop reroll;
- small Credits boost после Green Mission;
- revive recovery drone attempt.
```

Не делать:

```text
- forced ads;
- ad перед каждой миссией;
- ad после каждого поражения;
- ad как единственный способ восстановления.
```

Rewarded ads обычно работают лучше, чем навязчивая реклама, потому что дают опциональную ценность в обмен на внимание; чрезмерная реклама, наоборот, может повышать churn. ([Galaxy4Games][8])

---

# 31. Какую систему покупок выбрать для Space Y

Я бы выстроила приоритет так.

## Приоритет 1: Premium Operation Pass

Главный товар.

```text
- регулярный;
- понятный;
- лучший value;
- привязан к сезону;
- поддерживает retention.
```

---

## Приоритет 2: Cosmetics

Главный долгосрочный premium sink.

```text
- hull skins;
- engine trails;
- ignition VFX;
- explosion VFX;
- profile banners;
- hangar themes.
```

---

## Приоритет 3: Build Slots + Inventory

Лучшее convenience.

```text
- игроку реально нужны разные корабли;
- это не ломает бой;
- легко объяснить ценность.
```

---

## Приоритет 4: Research / Salvage Convenience

```text
- research accelerators;
- salvage choice;
- blueprint focus;
- repair kits;
- insurance coupons.
```

---

## Приоритет 5: Black Box Piggy Bank

Для конверсии non-payers.

```text
- игрок сам наполняет;
- покупка ощущается выгодной;
- хорошо работает с короткими Telegram-сессиями.
```

---

## Приоритет 6: Emergency Recovery

Для high-intent моментов.

```text
- после потери детали;
- после Red Contract;
- после boss fight.
```

Использовать аккуратно.

---

# 32. Что показывать игроку на рынке

Экран Market должен быть не магазином с кучей кнопок, а “космическим доком”.

Структура:

```text
Top:
- Credits
- Y-Crystals
- Stars purchase button
- current season timer

Tabs:
- Featured
- Daily
- Salvage
- Factions
- Research
- Cosmetics
- Premium
- Event
```

---

## Featured

Показывает 3–5 самых релевантных офферов.

Пример:

```text
1. Operation Pass
2. Rookie Engineer Pack
3. Current mission support pack
4. Cosmetic season set
5. Black Box Vault
```

---

## Daily

```text
- 6 товаров за Credits;
- 1 бесплатный daily item;
- 1 discounted item;
- 1 reroll.
```

---

## Salvage

```text
- повреждённые детали;
- rare connector panels;
- broken epic parts;
- дешёвые repair projects.
```

---

## Factions

```text
- товары по репутации;
- фракционные cosmetics;
- blueprint shards;
- tools.
```

---

## Research

```text
- accelerators;
- data shards;
- focus chips;
- research queue.
```

---

## Cosmetics

```text
- визуальные наборы;
- trails;
- decals;
- hangar themes.
```

---

## Premium

```text
- battle pass;
- Y-Crystals;
- monthly card;
- build slots;
- inventory;
- utility bundles.
```

---

## Event

```text
- сезонный токен-магазин;
- limited items;
- free earnable cosmetics;
- premium event bundle.
```

---

# 33. Персонализация офферов

Офферы должны зависеть от поведения игрока.

## Если игрок часто играет mining missions

Показывать:

```text
Mining Contract Pack
Heat Sink Bundle
Industrial Cosmetic Set
Research Focus: Mining
```

## Если игрок часто теряет детали

Показывать:

```text
Repair Bundle
Insurance Bundle
Recovery Drone Upgrade
```

## Если игрок собирает много билдов

Показывать:

```text
Build Slot Pack
Inventory Expansion
Ship Card Cosmetic Pack
```

## Если игрок часто делится в Telegram

Показывать:

```text
Social Pilot Pack
Animated Share Cards
Profile Banner
Squadron Cosmetics
```

## Если игрок почти купил pass, но не купил

Показывать:

```text
Claim your accumulated premium rewards:
- конкретный список уже накопленных наград
```

Не показывать всем одно и то же.

---

# 34. Покупательские сегменты

## Non-Payer

Цель:

```text
удержание + мягкая конверсия.
```

Показывать:

```text
- free rewards;
- rewarded ads;
- Black Box;
- starter pack;
- visible premium pass value.
```

---

## Minnow

Платит мало, редко.

Цель:

```text
первая покупка + monthly habit.
```

Показывать:

```text
- Rookie Engineer Pack;
- Monthly Supply Dock;
- cheap cosmetics;
- discounted pass.
```

---

## Dolphin

Платит регулярно.

Цель:

```text
battle pass + cosmetics + convenience.
```

Показывать:

```text
- Premium Pass;
- cosmetic bundles;
- build slots;
- research accelerators;
- salvage tokens.
```

---

## Whale

Платит много.

Цель:

```text
статус, коллекции, LiveOps, косметика, convenience.
```

Показывать:

```text
- Admiral Pass;
- exclusive cosmetic sets;
- archive cosmetics;
- hangar themes;
- profile prestige;
- collection completion.
```

Не давать:

```text
- бесконечную боевую силу.
```

---

# 35. KPI для проверки экономики

Нужно отслеживать:

```text
Battle Pass:
- pass view rate;
- premium conversion;
- Admiral upgrade rate;
- free completion rate;
- premium completion rate;
- purchase timing;
- levels completed before purchase.

Market:
- store open rate;
- offer CTR;
- purchase conversion;
- revenue per offer;
- refund rate;
- rage purchase signals;
- offer fatigue.

Economy:
- Credits earned/spent;
- repair cost as % of mission reward;
- Y-Crystals sources/sinks;
- inventory pressure;
- build slot usage;
- research queue usage.

Player Health:
- D1 / D7 / D30 retention;
- payer conversion;
- ARPDAU;
- ARPPU;
- session length;
- missions per day;
- churn after item loss;
- churn after failed purchase popup.
```

Особенно важно:

```text
churn after item loss
```

Если игроки уходят после потери детали, recovery/insurance слишком жёсткие.

---

# 36. Правила честной монетизации

```text
1. Не продавать прямую силу.
2. Не делать free игрока беспомощным.
3. Не делать ремонт дороже среднего дохода.
4. Не заставлять покупать recovery после каждой смерти.
5. Не продавать paid loot boxes с боевой силой.
6. Показывать odds для случайных платных предметов.
7. Дать free путь к functional content.
8. Premium должен ускорять, украшать, расширять, но не ломать баланс.
9. Все покупки должны быть понятны до оплаты.
10. В PvP не должно быть ощущения “меня победили кошельком”.
```

---

# 37. MVP-версия монетизации

Для первой версии не надо делать всё.

Я бы запускала MVP так:

```text
1. Free + Premium Battle Pass на 40 уровней.
2. Premium Pass и Admiral Pass.
3. Daily Market за Credits.
4. Salvage Bay.
5. Cosmetic Dock.
6. Build Slot purchase.
7. Inventory Expansion.
8. Research Accelerators.
9. Black Box Piggy Bank.
10. Starter Pack.
```

Не запускать в MVP:

```text
- платные loot boxes;
- сложный VIP;
- десятки валют;
- агрессивные fail offers;
- платные legendary детали;
- слишком много подписок.
```

---

# 38. Самая сильная итоговая формула

Для Space Y лучшая монетизация:

```text
Игрок платит не за то, чтобы победить.
Игрок платит за то, чтобы его корабль был красивее,
сборки удобнее,
исследования быстрее,
потерянные детали проще вернуть,
а сезонная прогрессия давала больше удовольствия.
```

Главные товары:

```text
1. Premium Operation Pass
2. Admiral Operation Pass
3. Cosmetic ship sets
4. Engine trails / ignition VFX
5. Build slots
6. Inventory expansion
7. Research accelerators
8. Salvage choice tokens
9. Black Box Piggy Bank
10. Emergency Recovery Tokens
```

И самое важное:

```text
Battle Pass должен усиливать главный кайф игры:
“Я собираю уникальный корабль, тестирую его в миссиях,
получаю детали, изучаю технологии,
чиню потери, меняю билд и возвращаюсь сильнее.”
```

Это будет намного устойчивее, чем продавать “легендарную пушку за донат”.

[1]: https://core.telegram.org/bots/payments-stars "Bot Payments API for Digital Goods and Services"
[2]: https://www.gamerefinery.com/12-ways-to-take-battle-passes-to-the-next-level-in-mobile-games/ "12 Ways to Take Battle Passes to the Next Level in Mobile Games"
[3]: https://www.gamemakers.com/p/understanding-battle-pass-game-design "️ The Complete Guide to Battle Pass Design & Monetization"
[4]: https://sensortower.com/state-of-gaming-2025 "State of Mobile Gaming 2025 | Industry-Leading Report"
[5]: https://newzoo.com/resources/blog/global-games-market-q2-2026 "
			Global games revenue cracked $200 billion in 2025 | Newzoo
		"
[6]: https://developer.apple.com/app-store/review/guidelines/ "App Review Guidelines - Apple Developer"
[7]: https://support.google.com/googleplay/android-developer/answer/17105854?hl=en-GB_nz "Developer Programme Policy - Play Console Help"
[8]: https://galaxy4games.com/en/knowledgebase/blog/monetization-strategies-for-mobile-games-and-apps-that-actually-work "Mobile Game Monetization Strategies That Actually Work in 2026 | IAP, Ads & LiveOps"
