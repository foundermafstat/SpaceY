Ниже — система виральных механик для **Space Y** как Telegram Mini App. Я бы строила её не как обычную рефералку, а как **социальный игровой слой**, где ссылки в чатах — это не “пригласи друга”, а реальные игровые объекты:

```text
SOS-маяк
обломок корабля
совместный контракт
запрос на редкий коннектор
дуэльный вызов
ремонтная заявка
групповой сектор
кооперативное исследование
```

Space Y идеально подходит для этого, потому что ядро игры уже основано на уникальных кораблях, модулях, повреждениях, луте, сборке, физике массы и разных билдах под разные задачи. Игрок вручную собирает корабль из деталей, а в бою управляет движением, пока оружие работает автоматически; глубина появляется именно из сборки, расположения модулей, двигателей, массы и роли корабля.  

---

# 1. Главный принцип виральности Space Y

Плохая механика:

```text
Пригласи 5 друзей и получи 100 кредитов.
```

Хорошая механика для Telegram:

```text
Мне оторвало редкий двигатель.
Я кидаю SOS в чат.
Друг открывает ссылку, отправляет rescue drone.
Я получаю шанс вернуть двигатель.
Друг получает salvage-награду.
Обе стороны заинтересованы.
```

То есть ссылка должна быть **не рекламной**, а **игровой**.

Формула:

```text
Игроку что-то нужно прямо сейчас
↓
Он делится игровой ссылкой в чат
↓
Друг открывает ссылку, потому что там есть понятная выгода
↓
Оба получают награду
↓
Друг остаётся в игре, потому что сразу попал в живой сценарий
```

---

# 2. Что взять из Duck My Duck

По описанию Duck My Duck, сильная социальная механика там не просто в “рефералах”, а в том, что игроки ищут партнёров для breeding: бот может отправлять ссылку в чат и матчить партнёров по уровню/редкости, игроки сами публикуют ссылки или скриншоты своих уток, а также объединяются в приватные группы для поиска редких комбинаций. ([PlayToEarn][1])

Для Space Y аналогом “breeding” может стать не размножение персонажей, а:

```text
Module Resonance
Panel Calibration
Blueprint Fusion
Connector Pairing
Ship Signature Sync
```

То есть два игрока временно “сводят” свои детали, панели или корабли, чтобы получить чертёж, фрагмент технологии, редкий коннектор, временный бафф или salvage crate.

Главная идея:

```text
У меня есть редкая панель Y-D04.
У тебя есть промышленный адаптер Y-D04.
Мы делаем Resonance Link.
Оба получаем blueprint shards.
Никто не теряет предметы.
```

Это очень похоже на социальный смысл Duck My Duck, но тематически идеально ложится на Space Y.

---

# 3. Техническая база Telegram Mini App

Telegram Mini Apps поддерживают запуск через прямые ссылки с `startapp`-параметром; этот параметр передаётся в Mini App, а при открытии из чата приложение также может получать контекст чата через `chat_type` и `chat_instance`. Это особенно полезно для групповых миссий, кооперативных контрактов, групповых секторов и асинхронных multiplayer-сценариев. ([Telegram][2])

Важно учитывать ограничение: Mini App не должна молча читать чат или отправлять сообщения от имени пользователя; для отправки сообщений пользователь должен сам выбрать отправку через inline/share-механики. Telegram также предоставляет методы вроде `switchInlineQuery` и `shareMessage` для сценариев, где пользователь явно делится подготовленным сообщением. ([Telegram][2])

Поэтому дизайн должен быть таким:

```text
Игрок нажимает “Share to chat”
↓
Telegram открывает выбор чата
↓
В чат улетает красивая игровая карточка
↓
Друг нажимает кнопку
↓
Mini App открывается с нужным startapp payload
```

---

# 4. Основная виральная петля Space Y

```text
1. Игрок проходит миссию.
2. В миссии происходит событие:
   - потерял модуль;
   - нашёл обломок;
   - открыл контракт;
   - получил редкий коннектор;
   - не хватает экипажа;
   - нужен партнёр для resonance;
   - появился босс;
   - корабль повреждён.
3. Игра предлагает поделиться ссылкой.
4. Друг открывает ссылку.
5. Друг получает короткое действие на 10–60 секунд:
   - отправить дрона;
   - забрать salvage;
   - вступить в контракт;
   - сразиться с ghost ship;
   - помочь исследованию;
   - занять crew slot.
6. Оба получают награду.
7. Другу предлагают остаться:
   - получить starter cabin;
   - собрать первый корабль;
   - забрать свою часть salvage;
   - открыть свой первый контракт.
```

---

# 5. Важное правило: ссылка должна быть “вещью”

В Space Y нельзя делать generic invite link как основной вирусный объект.

Не так:

```text
Join Space Y and get bonus.
```

А так:

```text
Irina lost a Rare Plasma Engine in asteroid field.
Send a rescue drone before it drifts away.
Reward: Scrap + Engine Parts for both pilots.
```

Или:

```text
Open Wreck Signal: Pirate Bomber debris detected.
5 pilots can salvage it.
Finder gets bonus if all slots are claimed.
```

Или:

```text
Connector Request: Y-D04 Industrial Joint needed.
Help calibrate the panel and get Data Shards.
```

---

# 6. Система социальных объектов

В игре нужно завести отдельную сущность:

```ts
type SocialEventType =
  | "sos_beacon"
  | "salvage_wreck"
  | "module_resonance"
  | "connector_request"
  | "coop_contract"
  | "ghost_duel"
  | "repair_help"
  | "crew_seat"
  | "research_link"
  | "group_sector_event"
  | "revenge_bounty"
  | "daily_comet_drop";
```

Каждый такой объект имеет:

```ts
interface SocialEvent {
  id: string;
  type: SocialEventType;

  ownerUserId: string;
  sourceChatInstance?: string;

  payload: Record<string, unknown>;

  maxClaims: number;
  currentClaims: number;

  expiresAt: string;

  ownerReward: RewardDef;
  participantReward: RewardDef;

  minParticipantLevel?: number;
  newUserAllowed: boolean;

  antiAbuseRules: {
    uniqueTelegramUsersOnly: boolean;
    noSameUserMultiClaim: boolean;
    rewardAfterActionComplete: boolean;
    dailyClaimLimit: number;
  };
}
```

---

# 7. Главные виральные механики

## 7.1. SOS Beacon

Это одна из самых сильных механик для Space Y.

### Когда появляется

После миссии, если игрок:

```text
- потерял панель;
- потерял элемент;
- получил broken-модуль;
- не смог забрать редкий salvage;
- корабль был уничтожен;
- в Red/Yellow contract оторвалась важная деталь.
```

### Что видит игрок

```text
Rare Flak Turret detached during battle.
Recovery chance: 42%

Send SOS Beacon to increase recovery chance.
```

Кнопка:

```text
Send SOS to Telegram
```

### Сообщение в чате

```text
SOS BEACON

Irina's ship lost a Rare Flak Turret near Titan Belt.
Send a rescue drone before it drifts away.

Reward for helper:
- 80 Credits
- 12 Scrap
- chance for Weapon Parts

Reward for Irina:
- +25% recovery chance
```

### Что делает друг

Друг открывает ссылку и видит:

```text
Send Rescue Drone
```

Для нового игрока можно дать микро-сцену:

```text
Управляй маленьким дроном 20 секунд,
подбери оторванную деталь,
избеги астероидов.
```

### Награды

Владелец:

```text
- повышает шанс вернуть модуль;
- снижает repair cost;
- может вернуть detached part в состоянии damaged/broken.
```

Помощник:

```text
- Credits;
- Scrap;
- Repair Tokens;
- маленький шанс на blueprint shard;
- прогресс Rescue Reputation.
```

### Почему это вирусно

Игрок не просто просит “зайди в игру”. Он просит помочь спасти конкретную редкую вещь.

---

## 7.2. Shared Salvage Wreck

После боя игрок может найти обломок, который нельзя забрать одному.

### Триггер

```text
Pirate Bomber destroyed.
Large wreck detected.
Your cargo capacity is too low.
Share wreck coordinates?
```

### Сообщение в чат

```text
WRECK SIGNAL

Pirate Bomber debris found.
5 pilots can salvage this wreck.

Possible loot:
- Scrap
- Engine Parts
- Missile Fragments
- Rare Connector Panel

Irina gets a finder bonus if the wreck is fully salvaged.
```

### Механика

```text
- есть 3–10 claim slots;
- каждый друг может открыть ссылку и забрать свою часть;
- владелец получает Finder Bonus за каждого реального участника;
- если все слоты заняты, владелец получает дополнительный бонус.
```

### Почему обе стороны заинтересованы

Владелец:

```text
получает finder fee, credits, reputation, бонус за полный сбор.
```

Друг:

```text
получает бесплатный salvage без риска.
```

Новый игрок:

```text
мгновенно получает первый лут и понимает суть игры.
```

---

## 7.3. Module Resonance

Это главный аналог Duck My Duck breeding.

Вместо “свести двух уток” игроки “резонируют” две детали, панели или кабины.

### Идея

```text
Две совместимые детали временно синхронизируются.
Игроки не теряют предметы.
Оба получают blueprint shards, calibration data или редкий modifier.
```

### Примеры

```text
Rare Heat Sink + Rare Mining Drill
→ Thermal Drill blueprint shards

Y-D04 Industrial Panel + Y-D04 Adapter
→ Industrial Connector Cache

EMP Emitter + Arc Lightning
→ Chain EMP blueprint shards

Two Cargo Bridges
→ Convoy Contract Bonus
```

### Сообщение в чат

```text
MODULE RESONANCE REQUEST

Irina is looking for a compatible Y-D Industrial module.
Match your panel to create calibration data.

Both pilots get:
- Data Shards
- Connector Fragments
- chance for Rare Blueprint Shard
```

### Варианты поиска партнёра

```text
1. Private invite
   Игрок отправляет ссылку другу.

2. Chat request
   Игрок кидает ссылку в игровой чат.

3. Anonymous resonance
   Ссылка публичная, первый подходящий игрок забирает слот.

4. Squadron resonance
   Работает только внутри группы/сквадрона.
```

### Почему это сильнее обычной рефералки

Потому что игроки начинают сами писать в чат:

```text
У кого есть Y-D04?
Нужен Rare Heat Sink для resonance.
Ищу EMP module для Chain blueprint.
```

Это создаёт живую коммуникацию, а не мёртвый “пригласи друга”.

---

## 7.4. Connector Request

У Space Y есть уникальная фишка: панели соединяются по идентификаторам. Значит, нехватка нужного коннектора сама становится социальным поводом.

### Сценарий

Игрок собирает корабль и видит:

```text
Cannot install Industrial Drill Panel.
Missing connector: Y-D04.
```

Игра предлагает:

```text
Ask chat for calibration help
```

### Сообщение

```text
CONNECTOR REQUEST

Irina needs Y-D04 Industrial Connector
to finish a Mining Rig build.

Help calibrate the joint and receive:
- Data Shards
- Connector Dust
- Repair Token
```

### Что делает друг

Варианты:

```text
1. У друга есть совместимая панель
   Он делает calibration scan.
   Предмет не теряется.

2. У друга нет панели
   Он может отправить market signal.
   Игра показывает владельцу temporary market listing.

3. Друг новый
   Он получает mini-task: scan abandoned panel.
```

### Награда владельца

```text
- temporary adapter discount;
- connector blueprint progress;
- шанс открыть market listing;
- снижение стоимости крафта adapter panel.
```

### Награда помощника

```text
- Credits;
- Data Shards;
- Connector Reputation;
- шанс получить маленький adapter shard.
```

Это идеально связано с core-геймплеем.

---

## 7.5. Co-op Contracts

Некоторые миссии должны быть рассчитаны на совместное участие через Telegram.

Не обязательно делать real-time co-op. Для MVP лучше асинхронный co-op:

```text
каждый игрок проходит свою маленькую часть,
а общий прогресс закрывает контракт.
```

### Типы co-op contracts

```text
Convoy Contract
- нужен Escort ship;
- нужен Scout ship;
- нужен Tug ship.

Meteorite Mining Party
- нужен Miner;
- нужен Guard;
- нужен Cargo Hauler.

Pirate Bounty Raid
- 3–5 игроков атакуют разные узлы пиратской базы.

Station Repair
- один чинит спутник;
- второй отбивает дронов;
- третий доставляет батареи.

Wormhole Mapping
- каждый игрок сканирует отдельную точку.
```

### Сообщение в чат

```text
CO-OP CONTRACT

Meteorite Mining Party
Slots:
1. Miner
2. Guard
3. Cargo Hauler

Irina opened the contract.
Join with your ship and get shared rewards.
```

### Почему это работает

Игроки делятся ссылкой не ради абстрактного бонуса, а потому что без других пилотов контракт хуже закрывается.

---

## 7.6. Crew Seats

У нас уже есть идея кабин с разным количеством экипажа. Это можно превратить в social mechanic.

### Принцип

Кабина имеет crew slots:

```text
Solo Pod: 1 slot
Twin Cockpit: 2 slots
Utility Cabin: 3 slots
Combat Cabin: 5 slots
Industrial Cabin: 6–8 slots
```

Часть crew slots может быть занята друзьями.

### Как это выглядит

```text
Invite friend as Engineer
Invite friend as Gunner
Invite friend as Navigator
Invite friend as Miner
Invite friend as Cargo Officer
```

Друг не управляет кораблём. Он становится “crew card” в корабле игрока.

### Бонусы

Owner получает небольшой бонус:

```text
Engineer friend:
- repair cost -2%
- heat stability +1%

Gunner friend:
- targeting speed +1%

Miner friend:
- mining power +2%

Navigator friend:
- scan range +2%
```

Друг получает:

```text
- passive crew reward, если владелец прошёл миссию;
- crew XP;
- reputation;
- daily reward за active crew.
```

### Важно по балансу

Бонусы должны быть маленькими, чтобы не было pay-to-win или “без друзей играть нельзя”.

Правильная формула:

```text
С друзьями приятнее и выгоднее.
Без друзей играть можно нормально.
```

---

## 7.7. Ghost Duel Challenge

Игрок делится своим кораблём как вызовом.

Так как в GDD уже заложен асинхронный PvP против кораблей других игроков под управлением AI, это очень хорошо подходит для Telegram Mini App. 

### Сценарий

Игрок собрал странный корабль:

```text
асимметричный railgun-фрегат,
быстрый EMP-диверсант,
тяжёлый mining-дредноут,
стеклянный laser scout.
```

Он нажимает:

```text
Challenge Friends
```

### Сообщение

```text
SHIP DUEL

Can you beat Irina's ship?
Build: EMP Needle
Threats: EMP + Arc Lightning
Reward: Data Shards for both pilots
```

### Что получает владелец

```text
- Defense Data;
- статистику слабых мест;
- Arena Reputation;
- если друг проиграл — defense bonus;
- если друг выиграл — weakness report.
```

### Что получает друг

```text
- Credits;
- Data Shards;
- challenge reward;
- возможность показать свой корабль в ответ.
```

### Почему это вирусно

Люди любят показывать свои сборки. Особенно если корабль выглядит уникально, а его форма реально влияет на поведение.

---

## 7.8. Build Card Sharing

Это не просто скриншот. Это интерактивная карточка корабля.

### Карточка содержит

```text
- изображение корабля;
- имя корабля;
- массу;
- DPS;
- mobility;
- редкие детали;
- потерянные/повреждённые части после боя;
- кнопку “Inspect Build”;
- кнопку “Fight Ghost”;
- кнопку “Use as Template”.
```

### Сообщение

```text
Irina built: Heavy Railgun Frigate

Mass: 184
DPS: 72
Mobility: Low
Weakness: Drones

Can your ship beat it?
```

### Для друга

Друг открывает ссылку и может:

```text
- посмотреть корабль;
- сразиться с AI-копией;
- сохранить шаблон;
- получить starter reward;
- отправить свой билд в ответ.
```

### Почему важно

Это создаёт “визуальную виральность”. Люди делятся не ссылкой, а своим творением.

---

## 7.9. Repair Help

После тяжёлых миссий корабль может быть повреждён. Друзья могут помочь ремонтом.

### Сценарий

```text
Ship damaged after Red Contract.
Repair cost: 1200 Credits.
Ask friends for repair drones?
```

### Сообщение

```text
REPAIR DOCK REQUEST

Irina's ship returned with heavy damage.
Send a repair drone and get Hangar Reputation.

Needed:
3 repair drones
```

### Что делает друг

```text
Send Free Repair Drone
```

У каждого игрока есть 1–3 бесплатных repair actions в день. Это не тратит его основные ресурсы.

### Награды

Владелец:

```text
- снижает repair cost;
- ускоряет восстановление;
- получает шанс сохранить condition детали.
```

Помощник:

```text
- Hangar Reputation;
- Credits;
- Repair Tokens;
- прогресс daily task.
```

---

## 7.10. Research Link

Исследование редких технологий можно частично сделать социальным.

### Сценарий

```text
Thermal Drill Research
Progress: 68%
Need: 5 External Scans
```

Игрок делится ссылкой.

### Сообщение

```text
RESEARCH LINK

Help Irina scan Thermal Drill fragments.
Each pilot can contribute one scan.

Both receive Data Shards.
```

### Что делает друг

```text
Contribute Scan
```

Это занимает 5–10 секунд.

### Зачем другу

```text
- получает Data Shards;
- получает шанс открыть эту технологию у себя как Discovered;
- получает Research Reputation.
```

### Зачем владельцу

```text
- ускоряет research;
- снижает стоимость завершения;
- открывает bonus roll.
```

---

## 7.11. Revenge Bounty

После поражения от пиратов игрок может создать bounty.

### Сценарий

```text
Pirate Ace destroyed your ship.
Create Revenge Bounty?
```

### Сообщение

```text
REVENGE BOUNTY

Pirate Ace “Red Vulture” destroyed Irina's ship.
Take revenge and claim the bounty.

Reward:
- Credits
- Weapon Parts
- shared revenge chest
```

### Что происходит

Друг открывает ссылку и проходит короткий бой против AI-врага.

Если друг побеждает:

```text
- друг получает bounty reward;
- владелец получает revenge chest;
- оба получают reputation.
```

### Почему работает

Это эмоционально сильнее, чем обычный invite:

```text
Помоги мне отомстить кораблю, который меня уничтожил.
```

---

## 7.12. Daily Comet Drop

Каждый день в игре появляются “кометы”, которые можно открыть только через чат.

### Сценарий

Игрок находит:

```text
Comet Cache detected.
This cache can be opened by 3 pilots.
```

### Сообщение

```text
COMET DROP

Irina found a drifting cache.
3 pilots can open it before it burns out.

Rewards:
- Credits
- Scrap
- chance for Blueprint Shard
```

### Механика

```text
- 3–5 claim slots;
- ограничение по времени: 2–6 часов;
- владелец получает finder bonus;
- участники получают claim reward;
- если все слоты закрыты, открывается bonus chest.
```

Это хороший daily viral loop.

---

## 7.13. Group Sector

Это одна из самых важных механик именно для Telegram.

Telegram Mini Apps могут использовать chat context при открытии из прямой ссылки, что позволяет привязать игровую активность к конкретному чату или группе. ([Telegram][2])

### Идея

Каждый Telegram group chat становится игровым сектором.

```text
Chat = Sector
Group = Squadron Base
Members = Pilots
Shared progress = Station / Fleet / Sector Control
```

### Что появляется в группе

```text
- групповая станция;
- weekly sector boss;
- общий склад scrap;
- групповой leaderboard;
- общие контракты;
- sector events;
- squadron research;
- групповые баффы.
```

### Пример

Группа открывает Space Y через ссылку:

```text
Open Sector for this chat
```

Игра создаёт:

```text
Sector ID based on chat_instance
```

Теперь все игроки из этой группы видят:

```text
Barcelona Pilots Sector
Level 3 Station
Weekly Threat: Drone Hive
Current Goal: collect 1200 Scrap
```

### Вирусный эффект

Игроки начинают звать друзей не просто в игру, а в свой сектор:

```text
Нам нужен ещё один miner для weekly boss.
Нам не хватает cargo pilots.
Нужен кто-то с point-defense build.
```

---

## 7.14. Squadron Contracts

Это развитие Group Sector.

### Контракт для группы

```text
Squadron Contract: Defend Mining Station

Required:
- 2 Escort ships
- 1 Mining ship
- 1 Repair ship
- 1 Scout ship
```

Каждый игрок открывает ссылку и выбирает слот.

### Награда

```text
- личная награда;
- group station XP;
- squadron chest;
- leaderboard points.
```

### Почему это важно

Это превращает чат в маленькую гильдию.

Notcoin, например, использовал squads, Telegram-чаты/каналы, приглашения, задания и лидерборды как социальный слой вокруг простой механики. ([TON App][3])
Space Y может сделать это глубже, потому что роли игроков зависят от их кораблей.

---

## 7.15. Squadron Vault

Групповая казна, но без прямой передачи редких предметов между игроками.

### Что можно вкладывать

```text
- Scrap;
- common materials;
- group tokens;
- repair charges;
- research points.
```

### Что нельзя вкладывать напрямую

```text
- legendary детали;
- premium currency;
- купленные предметы;
- предметы с высокой ценностью.
```

### Зачем нужна казна

```text
- открывать group contracts;
- ремонтировать group station;
- запускать sector scanner;
- открывать weekly boss;
- активировать group buffs.
```

Это создаёт долгосрочную причину возвращаться в чат.

---

# 8. Реферальная система, но правильная

Обычная рефералка всё равно нужна, но она должна быть вторичной.

## 8.1. Базовая friend invite

```text
Invite a pilot
Both get Starter Salvage Crate
```

Но награда должна выдаваться не за простой клик, а за действие:

```text
Новый игрок:
1. открыл Mini App;
2. собрал стартовый корабль;
3. прошёл первую миссию;
4. забрал награду.
```

Только после этого inviter получает полноценный бонус.

## 8.2. Что получает новый игрок

```text
- Starter Cabin;
- 4 базовые панели;
- 1 двигатель;
- 1 weapon;
- 1 shield;
- 300 Credits;
- 1 Starter Salvage Crate.
```

## 8.3. Что получает пригласивший

```text
- Credits;
- Referral Scrap;
- Data Shards;
- cosmetic progress;
- milestone reward за 1 / 3 / 5 / 10 активных друзей.
```

Ключевое слово — **активных**, а не просто приглашённых.

---

# 9. Премиальная виральность через Telegram Stars

Для создателей каналов и крупных комьюнити можно позже использовать affiliate layer. Telegram описывает affiliate-программы для Mini Apps: пользователь, бот или канал может получить referral link, а покупки приглашённых пользователей через Telegram Stars могут приносить комиссию в течение заданного периода. ([Telegram][4])

Для Space Y это можно использовать так:

```text
Creator Squadron Program
```

Канал или комьюнити создаёт свой Squadron Sector:

```text
@SomeCryptoChannel Sector
```

Участники заходят по affiliate-ссылке канала, играют в Space Y, а канал получает Stars-комиссию с покупок внутри игры, если включена такая программа.

Важно: это не должно заменять игровую виральность. Это отдельный слой для каналов и инфлюенсеров.

---

# 10. Конкретные сценарии взаимодействия через чаты

## Сценарий 1: “Мне оторвало двигатель”

```text
1. Игрок проходит Pirate Intercept.
2. В бою ему отрывает Rare Plasma Engine.
3. Post-battle экран показывает:
   “Engine detached. Recovery chance 35%.”
4. Игрок нажимает Send SOS.
5. В чат улетает SOS Beacon.
6. Друг открывает ссылку.
7. Друг отправляет rescue drone.
8. Владелец получает +20% recovery chance.
9. Друг получает Scrap + Engine Parts.
10. Если 3 друга помогли, двигатель возвращается damaged.
```

---

## Сценарий 2: “Нашла жирный обломок”

```text
1. Игрок уничтожает пиратский Bomber.
2. Выпадает Large Wreck.
3. У игрока мало cargo capacity.
4. Игра предлагает Share Wreck.
5. В чат улетает Wreck Signal на 5 слотов.
6. Каждый друг открывает и забирает свою часть.
7. Владелец получает finder bonus.
8. Если все 5 слотов закрыты, открывается bonus crate.
```

---

## Сценарий 3: “Нужен Y-D04”

```text
1. Игрок собирает mining build.
2. Не хватает connector Y-D04.
3. Игра предлагает Ask Chat.
4. В чат улетает Connector Request.
5. Друг с подходящей панелью делает calibration scan.
6. Владелец получает temporary adapter discount.
7. Друг получает Data Shards.
```

---

## Сценарий 4: “Ищу партнёра для Resonance”

```text
1. Игрок получил Rare EMP Emitter.
2. Для research нужен Arc-compatible module.
3. Игрок отправляет Module Resonance Request.
4. Друг с Arc Lightning открывает ссылку.
5. Система делает resonance.
6. Оба получают Chain EMP Blueprint Shards.
7. Предметы не теряются.
```

---

## Сценарий 5: “Групповой контракт в чате”

```text
1. В группе появляется Squadron Contract.
2. Нужно 4 роли:
   - Scout
   - Miner
   - Guard
   - Cargo Hauler
3. Игроки открывают ссылку и занимают слоты.
4. Каждый проходит свою мини-миссию.
5. Общий результат открывает group chest.
6. Группа получает station XP.
```

---

## Сценарий 6: “Проверь мой корабль”

```text
1. Игрок собрал странный корабль.
2. Нажимает Challenge Friends.
3. В чат улетает Build Card.
4. Друг открывает Ghost Duel.
5. Сражается против AI-копии.
6. Если побеждает, получает reward.
7. Владелец получает weakness report.
8. Игра предлагает другу отправить свой ответный билд.
```

---

# 11. Какие сообщения должны улетать в Telegram

Сообщения должны быть короткими, понятными и визуально привлекательными.

## SOS

```text
SOS BEACON

Irina lost a Rare Plasma Engine.
Send a rescue drone before it drifts away.

Helper reward:
Credits + Engine Parts

Owner reward:
Higher recovery chance
```

## Salvage

```text
WRECK SIGNAL

Pirate Bomber debris detected.
5 pilots can salvage it.

Possible loot:
Scrap / Missile Parts / Rare Connector
```

## Resonance

```text
MODULE RESONANCE

Looking for compatible Y-D Industrial module.
Match your panel and both pilots get blueprint shards.
```

## Duel

```text
SHIP DUEL

Can you beat Irina's EMP Needle?
Fight the ghost ship and claim Data Shards.
```

## Group Contract

```text
SQUADRON CONTRACT

Meteorite Mining Party
Slots open:
Miner / Guard / Cargo

Join the operation.
```

---

# 12. Как сделать ссылку технически

Не нужно зашивать все данные прямо в ссылку. Лучше создавать короткий event ID на сервере.

Пример:

```text
startapp=sos_A7K29
startapp=wreck_Q1P83
startapp=resonance_M9X11
startapp=duel_S4H77
startapp=sector_C8T42
```

На сервере:

```ts
interface StartAppPayload {
  eventId: string;
  eventType: SocialEventType;
  createdBy: string;
  expiresAt: string;
  nonce: string;
}
```

Flow:

```text
1. Игрок создаёт social event.
2. Сервер сохраняет event.
3. Клиент получает share payload.
4. Пользователь отправляет сообщение в чат.
5. Друг открывает ссылку.
6. Mini App получает startapp payload.
7. Клиент отправляет payload + Telegram initData на сервер.
8. Сервер валидирует initData.
9. Сервер проверяет event, лимиты, срок действия.
10. Игрок получает доступ к событию.
```

Telegram прямо предупреждает, что `initDataUnsafe` нельзя доверять, а данные нужно валидировать на сервере через `initData`, поэтому серверная проверка обязательна. ([Telegram][2])

---

# 13. Как не превратить это в спам

Виральность должна быть ограниченной и качественной.

## Ограничения

```text
- не больше 3–5 social shares в день с полноценной наградой;
- SOS можно отправить только после реальной потери/повреждения;
- Wreck Signal появляется только после реального боя;
- Connector Request появляется только если реально не хватает коннектора;
- Resonance Request требует реальную деталь;
- повторные клики одного и того же пользователя не дают награду;
- награда за нового игрока выдаётся после первой завершённой миссии;
- подозрительные цепочки A→B→A дают сниженный reward;
- события истекают по времени.
```

## Правильный подход

```text
Лучше 2 хорошие игровые ссылки в день,
чем 20 мусорных “пригласи друга”.
```

---

# 14. Антиабуз

Так как Telegram-игры часто страдают от мультиаккаунтов, нужно заложить защиту сразу.

## Правила

```text
1. Reward after completion
   Награда не за клик, а за завершённое действие.

2. Unique Telegram user
   Один user ID не может claim одно событие несколько раз.

3. Daily cap
   У каждого игрока лимит helper rewards в день.

4. Mutual farming cap
   Если два аккаунта постоянно помогают только друг другу, награды снижаются.

5. New user quality gate
   Реферальный бонус за нового игрока выдаётся после:
   - первой миссии;
   - сборки корабля;
   - достижения уровня 2;
   - или 10 минут активной игры.

6. No direct rare item transfer
   Игроки не должны напрямую передавать legendary/rare детали через ссылки.

7. Free help actions
   Помощь другу не должна тратить ценные ресурсы помощника.
   Иначе появится давление и токсичность.

8. Event expiration
   SOS, wreck и comet drop должны истекать.
```

---

# 15. Роли игроков в Telegram-чатах

Чтобы чаты жили, игроки должны иметь понятные роли.

```text
Miner
- открывает mining contracts;
- приносит Alloy;
- нужен для Meteorite Party.

Escort
- защищает convoy;
- нужен для Cargo Escort.

Scout
- открывает новые сектора;
- находит comet drops;
- улучшает group map.

Engineer
- помогает repair help;
- ускоряет research.

Hunter
- закрывает pirate bounties;
- приносит weapon parts.

Trader / Salvager
- находит wrecks;
- помогает connector requests.
```

Тогда в группе появляются реальные сообщения:

```text
Нужен Scout на wormhole contract.
У кого есть Cargo build?
Кто может помочь с repair?
У меня Y-D04, могу закрыть resonance.
Кидаю bounty на Red Vulture.
```

Это намного лучше, чем “плюс в чат, кто играет”.

---

# 16. Система Squadron / Guild

Для Telegram Mini App обязательно нужен групповой слой.

## Squadron создаётся из Telegram-чата

```text
Открыть Space Y из группы
↓
Создать Squadron Sector
↓
Все участники группы могут присоединиться
```

## У Squadron есть

```text
- название;
- уровень;
- сектор;
- станция;
- общий weekly goal;
- leaderboard;
- squadron chest;
- роли игроков;
- история контрактов;
- список лучших кораблей.
```

## Прогресс Squadron

```text
Level 1:
- group leaderboard
- daily group chest

Level 2:
- group contracts

Level 3:
- station upgrades

Level 4:
- weekly boss

Level 5:
- sector war / tournaments
```

---

# 17. Weekly Group Events

## 17.1. Drone Hive Week

```text
В секторе группы появился улей дронов.
Каждый участник может атаковать 3 раза в день.
Группа получает chest по суммарному урону.
```

Вирусный крючок:

```text
Нам не хватает 2 игроков до следующего chest tier.
```

## 17.2. Meteor Rush

```text
Группа собирает руду.
Нужны mining builds.
Игроки делятся mining contract links.
```

## 17.3. Pirate Invasion

```text
Пираты атакуют group station.
Игроки делятся defense links.
Если группа защищает станцию, все получают chest.
```

## 17.4. Connector Festival

```text
Редкие connector requests дают двойные награды.
Игроки активно ищут совместимые панели.
```

---

# 18. Механика “обе стороны заинтересованы”

Каждая ссылка должна иметь две награды.

| Механика          | Что получает владелец                 | Что получает друг                 |
| ----------------- | ------------------------------------- | --------------------------------- |
| SOS Beacon        | шанс вернуть деталь, дешевле ремонт   | credits, scrap, repair reputation |
| Wreck Signal      | finder bonus                          | salvage loot                      |
| Module Resonance  | blueprint progress                    | blueprint progress                |
| Connector Request | adapter discount / connector progress | data shards / connector fragments |
| Co-op Contract    | shared contract reward                | role reward                       |
| Crew Seat         | маленький buff                        | passive crew reward               |
| Ghost Duel        | defense data / arena reputation       | challenge reward                  |
| Repair Help       | дешевле ремонт                        | hangar reputation                 |
| Research Link     | быстрее research                      | data shards                       |
| Revenge Bounty    | revenge chest                         | bounty reward                     |
| Daily Comet       | finder bonus                          | comet claim                       |
| Squadron Event    | group progress                        | личная награда                    |

---

# 19. Что должно быть в MVP

Не надо сразу делать 20 механик. Для первой версии я бы взяла 5.

## MVP Viral Pack

```text
1. Friend Invite + Starter Salvage Crate
2. SOS Beacon
3. Shared Salvage Wreck
4. Module Resonance
5. Ghost Duel / Build Card
```

Почему именно эти:

```text
Friend Invite
- базовая рефералка нужна всегда.

SOS Beacon
- эмоциональная механика после потери детали.

Shared Salvage Wreck
- простая, понятная и полезная для всех.

Module Resonance
- главный аналог Duck My Duck breeding.

Ghost Duel
- показывает уникальность кораблей и провоцирует ответные вызовы.
```

Group Sector и Squadron Contracts можно добавить вторым этапом, когда появится достаточно игроков.

---

# 20. Первый пользовательский путь через чужую ссылку

Очень важно: новый игрок не должен попасть просто на главный экран.

Если он пришёл по SOS-ссылке, он должен сразу понять:

```text
Ты пришёл помочь Irina вернуть потерянный двигатель.
```

## Flow для нового игрока

```text
1. Открывает ссылку.
2. Видит короткий контекст:
   “Irina needs help recovering a Rare Plasma Engine.”
3. Получает временный rescue drone.
4. Делает действие за 20–30 секунд.
5. Получает награду.
6. Игра говорит:
   “Your first ship is ready. Want to build your own?”
7. Переходит в стартовый ангар.
```

Это намного сильнее, чем:

```text
Welcome to Space Y. Complete tutorial.
```

Потому что игрок пришёл по живой причине.

---

# 21. Виральные карточки должны быть красивыми

У Space Y визуально сильный потенциал: корабль состоит из видимых деталей, двигатели светятся, оружие стоит там, куда игрок его поставил, а повреждения могут появляться на конкретных частях. 

Поэтому каждая share-card должна иметь картинку:

```text
- корабль владельца;
- потерянный модуль;
- редкость детали;
- короткую награду;
- кнопку действия.
```

Пример карточки:

```text
[SOS IMAGE]
Корабль с оторванным левым двигателем

Irina lost Rare Plasma Engine
Send rescue drone
Reward: Engine Parts
```

Для Ghost Duel:

```text
[SHIP IMAGE]
EMP Needle

Can you beat this ship?
DPS: 48
Mobility: 91
Threat: EMP / Arc
```

Для Wreck:

```text
[WRECK IMAGE]
Pirate Bomber Debris

5 salvage slots open
Possible rare connector
```

---

# 22. Как встроить это в экономику

У нас уже есть две валюты и система деталей: Credits, premium currency, материалы, чертежи, physical parts, repair, loss/recovery. Виральные механики должны помогать экономике, но не ломать её.

## Что можно давать через социальные механики

```text
- Credits;
- Scrap;
- Data Shards;
- Repair Tokens;
- Blueprint Shards;
- low-tier materials;
- cosmetic progress;
- faction reputation;
- group reputation;
- temporary discounts;
- recovery chance boost.
```

## Что нельзя легко давать

```text
- готовые legendary детали;
- много premium currency;
- прямую покупную силу;
- бесконечные repair bypass;
- transferable rare items.
```

## Лучший тип награды

```text
фрагменты, шанс, ускорение, выбор, recovery boost
```

Не:

```text
готовая топовая пушка за 10 приглашений.
```

---

# 23. Виральность через потерю деталей

Поскольку в Space Y деталь может отвалиться во время боя, это можно сделать центральной социальной драмой.

Но важно:

```text
Потеря детали не должна быть наказанием ради шеринга.
Она должна быть событием, где sharing помогает смягчить последствия.
```

Пример:

```text
Rare Shield Generator lost.
Base recovery: 30%

Options:
- Pay insurance: +25%
- Use recovery drone: +20%
- Send SOS: up to +35%
```

Если игрок не делится — он всё ещё может восстановиться.

Если делится — получает дополнительный шанс.

---

# 24. Виральность через нехватку деталей

Нехватка коннектора, панели или crew-role — прекрасный повод обратиться в чат.

```text
Мне нужен Y-D04.
Мне нужен Miner crew.
Мне нужен Guard для mining party.
Мне нужен repair drone.
Мне нужен resonance partner.
```

Это естественные запросы, которые выглядят как игра, а не как реклама.

---

# 25. Виральность через гордость

Игроки должны хотеть показывать корабли.

Для этого нужны:

```text
- красивые build cards;
- название корабля;
- редкие модули на карточке;
- “weakness” и “threat”;
- возможность бросить вызов;
- возможность сохранить чужой билд как template.
```

Пример:

```text
Irina's ship: Cargo Brick
Mass: 312
Weapons: 2
Cargo: 18
Mobility: terrible
Survived: Red Contract
```

Это смешно, понятно и хочется открыть.

---

# 26. Виральность через конкуренцию

## Friend Leaderboard

```text
- кто больше заработал Credits за неделю;
- кто собрал самый тяжёлый корабль;
- кто прошёл больше Red Contracts;
- кто спас больше SOS;
- кто выиграл больше Ghost Duels;
- кто нашёл больше rare connectors.
```

## Group Leaderboard

```text
- лучший Squadron Sector;
- больше всего rescued modules;
- больше всего destroyed pirates;
- лучший mining output;
- лучший defense build.
```

## Share trigger

```text
You reached #1 in your chat this week.
Share your ship card.
```

---

# 27. Виральность через коллекционирование

Можно сделать коллекции, которые удобнее закрывать через социальные взаимодействия.

```text
Connector Families:
- Y-A
- Y-B
- Y-C
- Y-D
- Y-E
- Alien X

Blueprint Sets:
- Thermal Drill Set
- EMP Chain Set
- Cargo Bridge Set
- Drone Defense Set

Cosmetic Sets:
- Neon Hull Lines
- Plasma Trails
- Pirate Scratches
- Alien Glow
```

Игрок может делиться:

```text
Looking for Y-C family scan.
Need 2 more scans to complete Cargo Connector Set.
```

---

# 28. Event-дизайн для роста

## Launch Event: First Fleet

```text
Пригласи 3 активных пилотов в свой Fleet.
Все получают Founder's Salvage Crate.
Если все 3 проходят первую миссию, открывается Fleet Badge.
```

## Week 1: Rescue Week

```text
SOS rewards x2.
Игроки получают награды за помощь другим.
```

## Week 2: Resonance Week

```text
Module Resonance даёт больше blueprint shards.
Игроки активно ищут пары в чатах.
```

## Week 3: Squadron Week

```text
Группы создают свои первые sectors.
Top sectors получают cosmetic banners.
```

---

# 29. UI-раздел Friends

В игре нужен отдельный раздел:

```text
Friends / Squadron
```

Внутри:

```text
- Invite Friends
- Active SOS
- Open Wrecks
- Resonance Requests
- Crew Seats
- Ghost Challenges
- Squadron Contracts
- Help History
- Rewards Claim
```

Важно, чтобы игрок видел не просто список друзей, а **что сейчас можно сделать**.

Пример:

```text
Available actions today:
- Send 2 repair drones
- Claim 1 salvage wreck
- Join 1 resonance
- Challenge 3 ghost ships
```

---

# 30. UI-раздел Share Hub

Лучше сделать отдельный экран:

```text
Comms
```

Там игрок видит все возможные социальные действия:

```text
SOS Beacon
Available after battle damage

Wreck Signal
1 active wreck found

Module Resonance
2 compatible modules ready

Connector Request
Missing Y-D04

Ghost Duel
Share current ship

Crew Seats
2 empty crew slots

Squadron Contract
1 group contract active
```

Это помогает не прятать механику.

---

# 31. Как сделать “принуждение” мягким

Пользователь сказал “заставлять людей переходить по ссылкам”. Я бы формулировала это как **игровую необходимость**, но не жёсткий блокер.

Правильно:

```text
С друзьями ты быстрее восстановишь модуль.
```

Неправильно:

```text
Ты не можешь продолжить, пока не пригласишь 3 друзей.
```

Правильно:

```text
Для группового контракта нужны 3 пилота, но можно взять AI-ботов с меньшей наградой.
```

Неправильно:

```text
Контракт недоступен без реальных друзей.
```

Правильно:

```text
Module Resonance можно сделать с анонимным игроком из public pool, но через чат быстрее.
```

Неправильно:

```text
Редкие технологии открываются только через приглашения.
```

---

# 32. Баланс наград

## Friend invite

```text
New player completed first mission:
Owner: 300 Credits + Starter Referral Crate
Friend: Starter Salvage Crate
```

## SOS

```text
Helper:
50–150 Credits
10–30 Scrap
small chance for material

Owner:
+10–25% recovery chance per helper
max +50%
```

## Wreck

```text
Helper:
random salvage claim

Owner:
finder bonus per claim
full salvage bonus if all slots claimed
```

## Resonance

```text
Both:
5–20 Data Shards
1–3 Blueprint Shards
small chance for connector fragment
```

## Ghost Duel

```text
Challenger:
Credits + Data Shards

Owner:
Defense Data + Arena Reputation
```

## Repair Help

```text
Helper:
Hangar Reputation + small Credits

Owner:
repair cost -5% per helper
max -25%
```

---

# 33. Как не сломать экономику

Самая большая опасность — мультиаккаунты и фарм через ссылки.

Поэтому:

```text
- социальные награды маленькие, но частые;
- сильные награды выдаются фрагментами;
- rare/epic детали не передаются напрямую;
- premium currency почти не выдаётся через invite;
- reward за нового игрока только после активности;
- daily caps;
- server-side validation;
- event expiry;
- no infinite claim loops.
```

---

# 34. Что делать с публичными чатами

Нужно поощрять игроков создавать публичные “доки” для поиска партнёров.

Например:

```text
Official Space Y Dock
- resonance requests;
- connector requests;
- SOS;
- wrecks;
- squadron recruiting.

Mining Dock
- mining builds;
- industrial connectors;
- cargo contracts.

Bounty Dock
- revenge bounties;
- ghost duels;
- PvP challenges.

Market Dock
- adapter requests;
- blueprint scans;
- salvage announcements.
```

В самой игре можно дать кнопки:

```text
Post to Official Dock
Post to Squadron Chat
Share Privately
```

---

# 35. Creator / Channel механика

Для Telegram это важно.

## Channel Squadron

Канал может иметь свой сектор:

```text
@ChannelName Sector
```

Подписчики канала заходят в Space Y и присоединяются к сектору.

Канал получает:

```text
- leaderboard;
- weekly boss;
- custom banner;
- creator chest;
- affiliate Stars commission, если подключена Telegram affiliate-программа.
```

Игроки получают:

```text
- group rewards;
- channel cosmetics;
- squadron contracts.
```

---

# 36. Лучшая итоговая структура

Я бы сделала 4 слоя виральности.

## Layer 1: Personal Viral

```text
- invite friend;
- SOS;
- repair help;
- crew seat.
```

Цель:

```text
привести близких друзей.
```

## Layer 2: Chat Viral

```text
- salvage wreck;
- connector request;
- module resonance;
- ghost duel.
```

Цель:

```text
создать постоянный обмен ссылками в чатах.
```

## Layer 3: Group Viral

```text
- group sector;
- squadron contracts;
- group station;
- weekly boss.
```

Цель:

```text
превратить Telegram-группы в игровые кланы.
```

## Layer 4: Creator Viral

```text
- channel sectors;
- creator leaderboards;
- affiliate links;
- seasonal creator events.
```

Цель:

```text
подключить каналы и комьюнити.
```

---

# 37. Приоритет реализации

## Версия 0.1

```text
1. Deep link startapp payload
2. Friend invite
3. Starter reward for both sides
4. Basic share card
```

## Версия 0.2

```text
1. SOS Beacon
2. Repair Help
3. Shared Salvage Wreck
```

## Версия 0.3

```text
1. Ghost Duel
2. Build Card
3. Friend leaderboard
```

## Версия 0.4

```text
1. Module Resonance
2. Connector Request
3. Research Link
```

## Версия 0.5

```text
1. Group Sector
2. Squadron Contracts
3. Weekly Group Event
```

---

# 38. Самая сильная фишка для Space Y

Если выбрать одну механику, которую нужно сделать максимально качественно, я бы выбрала:

```text
Module Resonance + Connector Request
```

Почему:

```text
1. Это уникально для Space Y.
2. Это связано со сборкой корабля.
3. Это похоже на Duck My Duck breeding, но не копирует его.
4. Это заставляет игроков реально общаться.
5. Это создаёт органический спрос:
   “У кого есть Y-D04?”
   “Нужен EMP для resonance.”
   “Ищу Industrial panel.”
6. Это не обязательно требует real-time multiplayer.
7. Это легко масштабируется через Telegram-чаты.
```

Вторая по силе механика:

```text
SOS Beacon
```

Потому что она эмоциональная:

```text
мне оторвало редкую деталь,
помоги её вернуть.
```

Третья:

```text
Ghost Duel / Build Card
```

Потому что она показывает самое ценное в игре — уникальный корабль игрока.

---

# 39. Итоговая формула

**Space Y должна быть Telegram Mini App, где игроки делятся не реферальными ссылками, а космическими событиями.**

```text
Не “зайди в мою игру”.
А “спаси мой двигатель”.

Не “получи бонус за регистрацию”.
А “забери часть пиратского обломка”.

Не “пригласи друга”.
А “мне нужен Y-D04 коннектор”.

Не “поставь лайк”.
А “победи мой ghost ship”.

Не “вступи в клан”.
А “наш сектор атакует Drone Hive, нужен Escort build”.
```

Вот это даст Space Y шанс стать действительно социальной Telegram-игрой, а не очередной tap-to-earn рефералкой.

[1]: https://playtoearn.com/blockchaingame/duck-my-duck "DUCK × MY × DUCK - Game | PlayToEarn"
[2]: https://core.telegram.org/bots/webapps "Telegram Mini Apps"
[3]: https://ton.app/en/games/notcoin?id=1375&utm_source=chatgpt.com "Notcoin is a viral clicker game where you earn coins ..."
[4]: https://core.telegram.org/api/bots/referrals "Affiliate programs"
