# Space Y: экранный план полного игрового цикла и техническая дорожная карта релиза

Дата: 2026-07-09  
Репозиторий: `/Users/irine/Desktop/SpaceY`  
Цель документа: зафиксировать, какие экраны нужны для полного цикла игры, что должно находиться на каждом экране, какие системы нужно добавить к текущей реализации и в каком порядке довести проект до релизного состояния.

## 1. Краткий вывод

Space Y уже имеет сильную базу vertical prototype:

- главный интерактивный экран `/`;
- экран сборки корабля `/hangar`;
- локальный боевой экран `/battle`;
- reward reveal demo `/rewards`;
- UI kit `/ui-kit`;
- Zustand persist для сборки;
- кабины, панели, элементы, оверлеи, валидатор сборки;
- боевые системы энергии, тепла, щитов, оружия, hit-part damage и detach;
- локальная награда `+65 scrap` за победу.

Но текущая игра еще не закрывает полный цикл:

```text
контракт -> подготовка корабля -> миссия -> результат -> награды -> ремонт/инвентарь/рынок -> новый билд -> следующий контракт
```

Главный релизный пробел: нет mission layer. Сейчас игрок запускает `Survival Test`, а не выбирает контракт с целью, требованиями, наградой, риском и последствиями.

Первый релизный фокус: не расширять сразу все мета-системы, а закрыть короткий mission loop:

```text
выбрать миссию
-> увидеть инженерные требования
-> собрать/изменить корабль
-> запустить миссию
-> выполнить objective
-> увидеть mission result
-> получить и потратить награду
```

## 2. Что было проверено

Документация:

- `design-doc.md`;
- `design-doc2.md`;
- `game-technical-document.md`;
- `SPACEY_GAME_TECHNICAL_READINESS_AND_DEVELOPMENT_STAGES_2026-07-08_RU.md`;
- `ship-core-battle-technical-plan.md`;
- `ship-core-battle-milestone-execution-report.md`;
- `battlepass.md`;
- `freetoplay.md`;
- `viral.md`;
- `image-asset-generation-methodology.md`.

Кодовые поверхности:

- `app/page.tsx`;
- `app/hangar/page.tsx`;
- `app/battle/page.tsx`;
- `app/rewards/page.tsx`;
- `app/ui-kit/page.tsx`;
- `game/store/shipStore.ts`;
- `game/types.ts`;
- `game/ship/migration.ts`;
- `game/ship/validation.ts`;
- `game/ship/statsV2.ts`;
- `game/battle/systems/DamageSystem.ts`;
- `game/battle/systems/ShieldSystem.ts`;
- `game/battle/systems/PartDetachSystem.ts`;
- `components/battle/BattleCanvas.tsx`;
- `components/reward-reveal/*`;
- `scripts/smoke-playable.mjs`.

Команды сборки/тестов в этой проверке не запускались: задача документальная, а AGENTS.md требует не запускать тяжелые проверки без необходимости.

## 3. Текущее состояние экранов

### 3.1. `/` Home

Файл: `app/page.tsx`

Сейчас:

- рендерит `HomeSceneCanvas`;
- показывает две кнопки: `Battle` и `Hangar`;
- не показывает профиль, прогресс, выбранную миссию, ресурсы, daily loop или resume action.

Релизная роль:

- главный командный экран;
- быстрый вход в текущий контракт;
- вход в ангар, контракты, инвентарь, сезон, профиль.

### 3.2. `/hangar`

Файл: `app/hangar/page.tsx`

Сейчас:

- верхняя панель с именем билда и статами HP/MASS/SPD/DPS;
- кнопка `Test Battle` или `Blocked`;
- `Blockers / Warnings / Hints`;
- grid сборки;
- drag/drop кабин, панелей и элементов;
- режимы `Cabins & Panels` и `Elements`;
- overlay tabs: structure, power, heat, weapons, engines, mass;
- zoom/pan;
- `Rotate`, `Reset`;
- пресеты кораблей;
- палитры кабин, панелей и элементов;
- аудио установки деталей.

Релизная роль:

- инженерная подготовка под выбранный контракт;
- диагностика требований миссии;
- ремонт и состояние физических деталей;
- запуск миссии только после осознанного readiness check.

### 3.3. `/battle`

Файлы: `app/battle/page.tsx`, `components/battle/BattleCanvas.tsx`

Сейчас:

- берет текущую сборку из Zustand;
- считает `calculateShipStatsV2`;
- проверяет build blockers;
- запускает `BattleCanvas`;
- HUD показывает `Survival Test`, HP, DPS, acceleration, energy, heat, shield;
- victory при уничтожении всех врагов;
- defeat при уничтожении игрока;
- victory добавляет `+65 scrap`;
- result panel показывает `Victory` или `Ship Destroyed`;
- действия: `Hangar`, `Retry`.

Боевые системы уже есть:

- движение на базе массы/тяги;
- EnergySystem;
- HeatSystem;
- ShieldSystem;
- WeaponSystem;
- hit-part damage;
- part disable/detach;
- enemy runtime;
- VFX и audio.

Релизная роль:

- runtime конкретной миссии, а не тестовая арена;
- objective HUD;
- mission timer/progress;
- mission-specific enemies/hazards/loot;
- сбор результата для economy/progression.

### 3.4. `/rewards`

Файлы: `app/rewards/page.tsx`, `components/reward-reveal/*`

Сейчас:

- отдельная demo-страница reward reveal;
- preview rarity;
- pack opening demo;
- 3D/GSAP reveal animation.

Релизная роль:

- не самостоятельный core screen;
- использовать как компонент внутри mission result, battle pass, loot crates, salvage choice.

### 3.5. `/ui-kit`

Файл: `app/ui-kit/page.tsx`

Сейчас:

- demo для sliced sci-fi UI ассетов;
- кнопки, панели, баннеры, progress, HUD элементы.

Релизная роль:

- internal/reference screen;
- не показывать обычному игроку в production navigation.

## 4. Целевой полный цикл игры

### 4.1. First session loop

```text
Launch
-> onboarding / first contract
-> starter cabin
-> guided hangar build
-> first battle objective
-> result
-> first reward
-> install or buy one useful part
-> second contract unlock
```

Цель: за 3-7 минут игрок должен понять, что Space Y не про самый сильный корабль, а про правильный корабль под неправильную ситуацию.

### 4.2. Short mission loop

```text
Contracts
-> Mission Briefing
-> Hangar diagnostics
-> Launch Mission
-> Battle / Mission Runtime
-> Mission Result
-> Rewards / Damage / Salvage
-> Hangar
```

Это MVP loop. Его нужно закрыть первым.

### 4.3. Long progression loop

```text
Missions
-> credits/scrap/materials/blueprint shards
-> repair/craft/research/market
-> new physical parts
-> new ship archetype
-> harder contracts
-> season/event/social goals
```

Это release loop. Он делает игру долгоживущей.

## 5. Экраны, необходимые для полного цикла

Ниже перечислены все экраны релизного продукта. Часть экранов может быть реализована как route, часть как tab/panel/modal внутри существующего route. Для MVP лучше не плодить маршруты без нужды: mission board и briefing можно сначала встроить в `/hangar`.

### 5.1. Launch / Home / Command Center

Предлагаемый route: `/`

Статус: есть базовый экран, нужен product shell.

Что должно быть расположено:

- живая визуальная сцена;
- кнопка `Continue Mission` или `Select Contract`;
- кнопка `Hangar`;
- текущий корабль: имя, риск, готовность;
- быстрые ресурсы: Credits, Scrap, premium currency позже;
- индикатор season operation;
- daily reward / daily contract entry;
- профиль игрока;
- notification badges: damaged parts, completed research, unclaimed rewards.

Основные действия:

- продолжить выбранную миссию;
- открыть контракты;
- открыть ангар;
- забрать daily reward;
- открыть season/progression.

Definition of Done:

- игрок с первого экрана понимает, что делать дальше;
- после завершенной миссии главный экран показывает новый next action;
- нет прямого запуска hardcoded `Battle` без контекста миссии.

### 5.2. Onboarding / Tutorial

Предлагаемый route: `/onboarding` или scripted state внутри `/hangar` и `/battle`

Статус: отсутствует.

Что должно быть расположено:

- 3-5 шагов первого запуска;
- выбор или выдача starter cabin;
- подсказка по установке панели;
- подсказка по установке двигателя/оружия/реактора;
- запуск первой тренировочной миссии;
- объяснение результата и первой награды.

Основные действия:

- поставить первую панель;
- поставить первый элемент;
- нажать `Launch Training`;
- получить starter reward;
- перейти в normal mode.

Definition of Done:

- новый игрок без чтения GDD собирает валидный корабль;
- первая миссия завершается за 1-3 минуты;
- игрок получает понятную причину вернуться в ангар.

### 5.3. Contracts / Mission Board

Предлагаемый route: `/contracts`  
MVP-вариант: панель внутри `/hangar`

Статус: отсутствует.

Что должно быть расположено:

- список доступных контрактов;
- карточки миссий: name, risk, type, objective, expected duration;
- reward preview;
- hard requirements;
- recommended stats;
- hazards;
- enemy archetypes;
- lock/unlock conditions;
- reroll/refresh позже;
- фильтры: Green, Yellow, Red, Event, Story.

MVP-контракты из `design-doc2.md`:

- `Credit Sweep` - сбор лута, груз, скорость;
- `Cargo Escort` - защита объекта, point-defense, щиты;
- `Meteorite Drilling` - utility, бур, охлаждение, удержание позиции;
- `Pirate Intercept` - скорость, EMP, погоня;
- `Drone Hive Burn` - area damage, flak, защита от роя.

Основные действия:

- выбрать контракт;
- открыть briefing;
- сравнить текущий корабль с требованиями;
- перейти в ангар;
- запустить, если нет hard blockers.

Definition of Done:

- выбранная миссия сохраняется в state;
- `/hangar` и `/battle` видят один и тот же `selectedMissionId`;
- карточка миссии объясняет, зачем менять корабль.

### 5.4. Mission Briefing / Engineering Brief

Предлагаемый route: `/contracts/[missionId]`  
MVP-вариант: modal/drawer в `/hangar`

Статус: отсутствует.

Что должно быть расположено:

- название миссии;
- fiction summary;
- objective;
- risk level;
- reward table;
- required tools;
- recommended engineering profile;
- hazards;
- enemy list;
- readiness checklist текущего корабля;
- launch button;
- `Modify Ship` button.

Пример диагностики:

```text
Mission: Meteorite Drilling

Hard requirements:
- Mining tool: missing

Recommendations:
- Mining Power: 0 / 50
- Cargo: 2 / 6
- Heat Stability: 18 / 45
- Point Defense: 0 / 15

Suggested changes:
- install Drill or Mining Laser
- add Heat Sink Panel
- add Cargo Container
- add Side Thrusters
```

Definition of Done:

- hard blocker нельзя игнорировать;
- warnings можно игнорировать;
- suggested changes не автособирают корабль, а объясняют инженерную задачу.

### 5.5. Hangar / Ship Builder

Route: `/hangar`

Статус: есть сильная база, нужен mission-aware слой.

Что должно быть добавлено:

- выбранная миссия в topbar;
- readiness score;
- hard requirements panel;
- mission warnings/hints рядом с build warnings/hints;
- кнопка `Launch Contract`, а не `Test Battle`;
- индикатор стоимости ремонта;
- состояние физических деталей: inventory/installed/damaged/broken;
- ресурсная панель: Credits, Scrap, Materials;
- quick filters для деталей: mission tool, weapon, engine, defense, cargo, utility;
- сравнение текущего билда с recommended mission profile;
- сохранение build presets под типы миссий.

Важные существующие элементы, которые нужно сохранить:

- drag/drop;
- rotation;
- grid overlays;
- cabin/panel/element layers;
- validation blockers/warnings/hints;
- stats strip;
- presets;
- install sounds.

Definition of Done:

- игрок видит не только "корабль валиден", но и "корабль подходит/не подходит под выбранную миссию";
- запуск миссии идет из выбранного контракта;
- билд, показанный в ангаре, совпадает с билдом в battle runtime.

### 5.6. Inventory / Parts Vault

Предлагаемый route: `/inventory`  
MVP-вариант: tab/drawer внутри `/hangar`

Статус: отсутствует.

Что должно быть расположено:

- список физических деталей;
- фильтры: panels, engines, weapons, reactors, shields, utility, cargo, mining;
- состояние предмета: inventory, installed, damaged, broken, locked;
- condition percentage;
- rarity;
- blueprint ownership;
- количество копий;
- repair/sell/scrap actions;
- details panel со статами;
- warning, если installed item используется в текущем build.

Definition of Done:

- установленная деталь связана с конкретным inventory item id;
- награды миссий добавляют предметы/материалы в inventory;
- повреждение после боя может менять состояние конкретной детали.

### 5.7. Repair / Service Bay

Предлагаемый route: `/repair`  
MVP-вариант: panel после mission result или tab в `/hangar`

Статус: отсутствует.

Что должно быть расположено:

- список поврежденных деталей;
- `Repair All`;
- repair cost;
- condition before/after;
- broken/lost/recovered status;
- insurance effects;
- warning о влиянии на текущий build.

Definition of Done:

- бой создает экономическое последствие;
- игрок может восстановить корабль ресурсами;
- failure не ломает весь прогресс.

### 5.8. Market / Shop

Предлагаемый route: `/market`

Статус: отсутствует.

Что должно быть расположено:

- common parts shop;
- panel shop;
- utility shop;
- rotating offers;
- sell/scrap broken parts;
- buy with Credits;
- premium cosmetics позже;
- no direct pay-to-win power.

Definition of Done:

- игрок может потратить награды на улучшение корабля;
- после 1-2 миссий есть минимум один полезный purchase path.

### 5.9. Research / Blueprints

Предлагаемый route: `/research`

Статус: отсутствует.

Что должно быть расположено:

- blueprint list;
- shards/progress bars;
- unlocked technologies;
- craft requirements;
- research queue later;
- claim completed research;
- source hints: where to farm shards.

Definition of Done:

- чертежи являются permanent progression;
- потеря физической детали не уничтожает долгосрочный прогресс;
- за 30-60 минут игрок открывает хотя бы одну полезную технологию.

### 5.10. Crafting

Предлагаемый route: `/crafting` или tab в `/research`

Статус: отсутствует.

Что должно быть расположено:

- craftable items from blueprints;
- required materials;
- credits cost;
- preview stats;
- inventory capacity;
- craft result reveal.

Definition of Done:

- blueprint + materials создают physical copy;
- crafted copy может быть installed, damaged, repaired, sold.

### 5.11. Crew / Roster

Предлагаемый route: `/crew`

Статус: частично в данных есть `crew` у кабин, но системы экипажа нет.

Что должно быть расположено:

- roster members;
- roles: pilot, engineer, gunner, miner, medic, scanner;
- assigned/free crew slots;
- cabin capacity;
- mission requirements: free crew, engineer, rescue seats;
- portraits;
- injuries/fatigue later;
- bonuses.

MVP:

- можно не делать отдельный экран;
- достаточно crew capacity/free slots в Mission Briefing и Hangar diagnostics.

Release:

- отдельный screen нужен, если crew влияет на миссии, rescue, repair, mining, boarding, social mechanics.

### 5.12. Battle / Mission Runtime

Route: `/battle`

Статус: боевой runtime есть, mission runtime отсутствует.

Что должно быть расположено:

- mission title;
- objective progress;
- timer;
- risk/hazard indicators;
- player HP/shield/heat/energy;
- key mission stat: cargo, mining, escort health, collected scrap, scan progress;
- enemy markers;
- loot markers;
- warnings: overheating, shield down, objective failing;
- pause button;
- result trigger.

Нужные objective types для MVP:

- `destroy_all`;
- `survive_seconds`;
- `collect_scrap`;
- `protect_target`;
- `hold_position`;

Definition of Done:

- battle больше не hardcoded `Survival Test`;
- mission objective определяет victory/failure;
- result содержит duration, damage, kills, collected loot, success/failure reason.

### 5.13. Pause / Mission Menu

Предлагаемый modal внутри `/battle`

Статус: отсутствует.

Что должно быть расположено:

- resume;
- abort mission;
- settings;
- controls;
- objective summary;
- rewards at risk;
- confirm abort.

Definition of Done:

- игрок может безопасно выйти из миссии;
- abort имеет понятные последствия.

### 5.14. Mission Result

Предлагаемый route: `/mission-result` или overlay в `/battle`

Статус: есть только простая result panel `Victory` / `Ship Destroyed`.

Что должно быть расположено:

- `Mission Complete` / `Mission Failed`;
- objective completion;
- duration;
- enemies destroyed;
- damage taken;
- parts damaged/detached/lost;
- reward breakdown;
- bonus objectives;
- XP/progression;
- buttons: `Continue`, `Repair`, `Back to Hangar`, `Next Contract`;
- reward reveal component for rare items.

Definition of Done:

- результат объясняет, что произошло;
- награды зависят от миссии, риска и performance;
- результат записывается в progression/inventory.

### 5.15. Salvage Choice

Предлагаемый screen после Mission Result

Статус: отсутствует.

Что должно быть расположено:

- 1-3 найденных salvage items;
- выбор по лимиту;
- rarity;
- risk/source;
- compare with inventory;
- premium convenience позже, без продажи прямой силы.

Definition of Done:

- post-battle становится выбором, а не просто `+65 scrap`;
- игрок иногда выбирает между деньгами, материалами и деталью.

### 5.16. Season Operation / Battle Pass

Предлагаемый route: `/season`

Статус: описано в `battlepass.md`, не реализовано.

Что должно быть расположено:

- current operation name;
- free track;
- premium track later;
- levels;
- XP progress;
- daily/weekly missions;
- unclaimed rewards;
- cosmetics;
- season timer.

Definition of Done:

- сезон добавляет retention, но не блокирует core progression;
- premium не продает абсолютную боевую силу.

### 5.17. Daily / Weekly Objectives

Предлагаемый route: `/objectives` или panel в `/season`

Статус: отсутствует.

Что должно быть расположено:

- daily tasks;
- weekly tasks;
- event objectives;
- progress;
- claim rewards;
- reroll later.

Definition of Done:

- игрок получает причину вернуться без принуждения к grind;
- objectives привязаны к реальным действиям: пройти cargo mission, собрать salvage, починить деталь.

### 5.18. Profile / Account

Предлагаемый route: `/profile`

Статус: отсутствует.

Что должно быть расположено:

- player name/avatar;
- level;
- progression stats;
- best ships;
- completed contracts;
- achievements;
- linked Telegram account later;
- settings entry.

Definition of Done:

- player identity отделена от локального prototype state;
- есть future-proof место для backend account.

### 5.19. Social / Telegram Share

Предлагаемый route: `/social` или contextual dialogs

Статус: описано в `viral.md`, не реализовано.

Что должно быть расположено:

- SOS beacon;
- salvage signal;
- co-op contract invite;
- module resonance request;
- repair request;
- share preview;
- reward for helper and sender.

Definition of Done:

- share link является игровой вещью, а не generic invite;
- payload открывает Mini App в конкретный сценарий.

### 5.20. Settings

Предлагаемый route: `/settings` или modal

Статус: отсутствует как отдельный экран.

Что должно быть расположено:

- audio volume;
- reduced motion;
- graphics quality;
- controls;
- language;
- account;
- privacy/legal later.

Definition of Done:

- игрок может отключить тяжелые эффекты;
- mobile performance можно адаптировать.

### 5.21. Balance Debug Screen

Предлагаемый route: `/debug/balance`

Статус: отсутствует.

Что должно быть расположено:

- mission table;
- requirements;
- rewards;
- enemy budget;
- expected reward per minute;
- repair cost;
- success/fail stats from local telemetry;
- build readiness snapshots.

Definition of Done:

- screen скрыт из production navigation;
- используется для настройки экономики и сложности.

## 6. Минимальный экранный набор для MVP

Не все экраны нужны в первом playable MVP. Минимальный набор:

1. `/` Home
   - заменить прямой `Battle` на `Contracts` или `Continue`.

2. `/hangar`
   - добавить mission board panel;
   - добавить mission readiness diagnostics;
   - заменить `Test Battle` на `Launch Contract`.

3. `/battle`
   - принять selected mission;
   - показать objective HUD;
   - вернуть mission result.

4. Mission Result overlay
   - reward breakdown;
   - damage summary;
   - `Back to Hangar`.

5. Inventory/Wallet minimal panel
   - Credits/Scrap/Materials;
   - 1-2 способа потратить награду.

Этого достаточно, чтобы игра перестала быть тестовой ареной и стала mission game.

## 7. Нужные модели данных

### 7.1. MissionDef

Добавить: `game/data/missions.ts` и/или `game/mission/types.ts`.

```ts
export type MissionRisk = "green" | "yellow" | "red";
export type MissionObjectiveType =
  | "destroy_all"
  | "survive_seconds"
  | "collect_scrap"
  | "protect_target"
  | "hold_position";

export type MissionDef = {
  id: string;
  name: string;
  type: "salvage" | "escort" | "mining" | "intercept" | "defense";
  risk: MissionRisk;
  durationSec?: number;
  objective: {
    type: MissionObjectiveType;
    target: number;
    label: string;
  };
  hardRequirements: {
    requiredTags?: string[];
    minCargoCapacity?: number;
    minFreeCrew?: number;
  };
  recommendations: {
    dps?: number;
    shield?: number;
    speed?: number;
    acceleration?: number;
    heatStability?: number;
    cargoCapacity?: number;
    miningPower?: number;
    pointDefense?: number;
  };
  hazards: string[];
  enemyKinds: string[];
  rewards: MissionRewardDef;
};
```

### 7.2. Mission readiness

Добавить: `game/mission/readiness.ts`.

```ts
export type MissionReadiness = {
  score: number;
  blockers: string[];
  warnings: string[];
  hints: string[];
  recommendedChanges: string[];
};
```

Использовать:

- `calculateShipStatsV2(build)`;
- tags модулей;
- future inventory condition;
- mission hard requirements.

### 7.3. Mission runtime

Добавить: `game/mission/runtime.ts`.

```ts
export type MissionRuntimeState = {
  missionId: string;
  status: "running" | "success" | "failed";
  elapsedSec: number;
  progress: number;
  target: number;
  kills: number;
  damageTaken: number;
  collectedScrap: number;
};
```

### 7.4. Mission result

```ts
export type MissionResult = {
  missionId: string;
  success: boolean;
  failureReason?: string;
  durationSec: number;
  objectiveProgress: number;
  kills: number;
  damageTaken: number;
  damagedPartIds: string[];
  detachedPartIds: string[];
  rewards: MissionRewardGrant[];
};
```

### 7.5. Inventory state

Добавить позже, после short loop v1.

```ts
export type ItemCondition = "new" | "used" | "damaged" | "broken";
export type ItemLocation = "inventory" | "installed" | "lost";

export type InventoryItem = {
  id: string;
  defId: string;
  kind: "panel" | "element" | "cabin";
  rarity: string;
  condition: ItemCondition;
  durability: number;
  location: ItemLocation;
  installedInstanceId?: string;
};
```

### 7.6. Wallet / progression

```ts
export type PlayerWallet = {
  credits: number;
  scrap: number;
  alloy: number;
  dataShards: number;
  yCrystals?: number;
};

export type PlayerProgression = {
  level: number;
  xp: number;
  unlockedMissionTiers: string[];
  researchedBlueprintIds: string[];
  completedMissionIds: string[];
};
```

## 8. Store architecture

Текущий `game/store/shipStore.ts` хранит:

- `build`;
- `buildMode`;
- `selectedModuleId`;
- `selectedPanelId`;
- `rotation`;
- `scrap`;
- actions сборки.

Краткосрочно можно расширить существующий store:

- `selectedMissionId`;
- `lastMissionResult`;
- `wallet`;
- `selectMission`;
- `completeMission`;
- `grantRewards`.

Но для релиза лучше разделить домены:

- `shipStore` - текущая сборка и editor state;
- `missionStore` - selected mission, runtime/result;
- `inventoryStore` - physical items, wallet, blueprints;
- `profileStore` - account/progression/settings.

Переход должен быть постепенным: сначала добавить mission state без большого refactor, затем вынести отдельные stores, когда появится inventory.

## 9. Backend contract для релиза

Для local MVP backend не нужен. Для production economy backend обязателен.

Минимальные сущности backend:

- user;
- ship builds;
- inventory items;
- wallet balances;
- missions;
- mission attempts;
- mission results;
- rewards ledger;
- season progress;
- purchases later.

Минимальные endpoints:

```text
GET  /api/me
GET  /api/missions
POST /api/missions/:id/start
POST /api/missions/:attemptId/complete
GET  /api/inventory
POST /api/builds
PUT  /api/builds/:id
POST /api/repair
POST /api/craft
GET  /api/season
POST /api/rewards/claim
```

Правило релиза:

- клиент может симулировать бой;
- backend должен авторитетно выдавать награды;
- backend должен проверять attempt, mission, risk, reward caps;
- wallet и inventory нельзя доверять localStorage.

## 10. Техническая дорожная карта

### Этап 0. Стабилизация текущего прототипа

Цель: не ломать уже работающий playable prototype.

Задачи:

- обновить smoke script, чтобы проверял `/`, `/hangar`, `/battle`, `/rewards`;
- зафиксировать текущий build baseline;
- проверить asset validation;
- не начинать mission layer, если базовый `/hangar -> /battle` сломан.

Готовность:

- `/hangar` открывается;
- `/battle` открывается;
- выбранная сборка попадает в бой;
- нет блокирующих TypeScript ошибок.

### Этап 1. Mission data layer

Задачи:

- создать `game/data/missions.ts`;
- добавить 3 Green mission;
- добавить `MissionDef`;
- добавить `selectedMissionId`;
- добавить mission select action;
- заменить hardcoded title `Survival Test` на selected mission title с fallback.

Готовность:

- игрок может выбрать миссию;
- выбор сохраняется;
- `/battle` отображает выбранную миссию.

### Этап 2. Mission Board + Briefing

Задачи:

- добавить mission board panel в `/hangar`;
- добавить карточки миссий;
- добавить briefing drawer;
- показать objective, risk, reward, requirements;
- добавить `evaluateMissionReadiness(build, mission)`.

Готовность:

- игрок понимает, какой билд нужен;
- hard blockers видны до старта;
- warnings не блокируют запуск.

### Этап 3. Objective runtime

Задачи:

- добавить `MissionRuntimeState`;
- реализовать `destroy_all` поверх текущей победы;
- добавить `survive_seconds`;
- добавить HUD progress;
- добавить result payload вместо простого `victory/defeat`.

Готовность:

- минимум две разные миссии завершаются разными условиями;
- result знает, почему mission success/fail.

### Этап 4. Mission Result + rewards

Задачи:

- заменить result panel;
- добавить reward breakdown;
- добавить damage summary;
- добавить local wallet grants;
- добавить `credits` и `materials` рядом с `scrap`;
- встроить reward reveal для rare grants.

Готовность:

- short loop закрыт;
- после победы игрок получает ресурс;
- ресурс виден в UI;
- игрок возвращается в ангар с измененным состоянием.

### Этап 5. First spend path

Задачи:

- добавить простую покупку панели/детали за Credits/Scrap;
- или добавить repair action;
- показать ресурсную стоимость;
- обновить UI inventory/wallet minimal.

Готовность:

- игрок может потратить награду на улучшение или восстановление корабля;
- появляется loop "миссия -> награда -> улучшение".

### Этап 6. MVP mission pack

Задачи:

- реализовать 5 MVP missions:
  - Credit Sweep;
  - Cargo Escort;
  - Meteorite Drilling;
  - Pirate Intercept;
  - Drone Hive Burn.
- добавить utility tags и минимальные mission tools;
- добавить cargo/mining/point-defense stats;
- добавить enemy budgets/hazards.

Готовность:

- разные миссии требуют разные билды;
- один универсальный DPS билд не оптимален для всех целей.

### Этап 7. Inventory and damage persistence

Задачи:

- добавить physical item model;
- связать installed modules/panels с item ids;
- сохранять damaged/broken after battle;
- добавить repair;
- добавить salvage choice.

Готовность:

- деталь может быть повреждена;
- чертеж/прогресс не теряется;
- игрок может восстановить корабль.

### Этап 8. Research / crafting / market

Задачи:

- добавить blueprints;
- добавить shards;
- добавить craft;
- добавить basic market;
- добавить unlock tiers.

Готовность:

- за 30-60 минут игрок открывает новую деталь или билд-направление;
- progression не зависит только от случайного drop.

### Этап 9. Backend readiness

Задачи:

- описать API contract;
- вынести user/wallet/inventory/mission attempts на backend;
- добавить reward ledger;
- добавить anti-cheat caps;
- добавить account linking.

Готовность:

- награды и inventory не живут только в localStorage;
- mission complete нельзя бесконечно подделывать клиентом.

### Этап 10. Telegram / social / monetization

Задачи:

- Mini App launch payload;
- SOS/salvage/resonance links;
- Telegram Stars purchase flow later;
- season operation;
- cosmetics/reward tracks.

Готовность:

- share payload является игровым объектом;
- premium не продает прямую победу.

### Этап 11. QA and release hardening

Задачи:

- unit tests для mission readiness;
- unit tests для rewards;
- unit tests для inventory transitions;
- smoke для full short loop;
- Playwright e2e для mission select -> hangar -> battle -> result;
- canvas nonblank checks;
- mobile layout checks;
- performance budget;
- error boundary;
- save migration tests.

Готовность:

- релизная сборка воспроизводимо проходит smoke/e2e;
- нет критических console errors;
- сохранения старых игроков мигрируют.

## 11. Acceptance criteria для MVP

MVP можно считать настоящей игрой, когда:

- есть минимум 3 миссии;
- игрок выбирает миссию до боя;
- ангар показывает требования выбранной миссии;
- бой показывает objective progress;
- victory/failure зависит от objective;
- result показывает reward breakdown;
- reward сохраняется;
- reward можно потратить хотя бы одним способом;
- после результата игрок понимает, почему стоит перестроить корабль;
- smoke покрывает `/hangar`, mission select, `/battle`, result.

## 12. Acceptance criteria для release candidate

Release candidate можно рассматривать, когда:

- есть 5 MVP mission types;
- есть inventory physical parts;
- есть repair;
- есть market или crafting;
- есть blueprints/research;
- есть Green/Yellow/Red risk;
- есть persisted progression;
- есть backend contract или backend implementation;
- есть first-session onboarding;
- есть mobile QA;
- есть performance QA;
- есть telemetry для mission success/failure;
- есть clear content plan на первый сезон;
- нет production navigation к `/ui-kit` и debug screens.

## 13. Главные риски

| Риск | Влияние | Решение |
| --- | --- | --- |
| Нет mission abstraction | Игра остается тестовой ареной | Начать с `MissionDef`, selected mission state, objective HUD |
| Слишком ранний backend | Замедлит MVP | Сначала local short loop, затем backend contract |
| Слишком много экранов сразу | Размоет фокус | MVP: contracts panel в `/hangar`, result overlay в `/battle` |
| Нет first spend path | Награды бессмысленны | Добавить repair или покупку common детали |
| Потеря деталей без blueprints | Игрок боится играть | Permanent blueprint progression до жестких потерь |
| Миссии не меняют билды | Space Y теряет ядро | Каждая миссия проверяет минимум 3 параметра сборки |
| UI перегружен | Mobile UX ломается | Делать progressive disclosure: board -> briefing -> diagnostics |
| LocalStorage economy | Нельзя выпускать production economy | Backend reward ledger перед soft launch |

## 14. Рекомендуемый порядок реализации экранов

1. `/hangar`: mission board panel.
2. `/hangar`: mission briefing drawer.
3. `shipStore`: selected mission and last result.
4. `/battle`: mission title and objective HUD.
5. `BattleCanvas`: mission runtime hooks.
6. `/battle`: mission result overlay.
7. `/hangar`: wallet/resources strip.
8. `/hangar`: first spend path.
9. `/inventory`: минимальный parts vault.
10. `/contracts`: вынести mission board в отдельный экран, когда panel станет тесной.
11. `/repair`, `/market`, `/research`.
12. `/season`, `/profile`, `/social`.

Такой порядок сохраняет текущий рабочий `/hangar -> /battle`, но постепенно превращает его в полноценный игровой цикл.

## 15. Практический следующий патч

Самый правильный следующий кодовый патч:

```text
Mission Loop Patch 1
```

Состав:

- `game/data/missions.ts`;
- `game/mission/readiness.ts`;
- расширить `game/store/shipStore.ts`:
  - `selectedMissionId`;
  - `selectMission`;
  - `lastMissionResult`;
- добавить mission board panel в `app/hangar/page.tsx`;
- заменить `Test Battle` на `Launch Contract`;
- показать selected mission в `app/battle/page.tsx`;
- обновить `scripts/smoke-playable.mjs` маркером selected mission.

Не включать в первый патч:

- backend;
- full inventory;
- battle pass;
- Telegram;
- paid economy;
- большие рефакторы `BattleCanvas`.

Цель первого патча: доказать, что игра теперь начинается с контракта, а не с тестовой арены.

