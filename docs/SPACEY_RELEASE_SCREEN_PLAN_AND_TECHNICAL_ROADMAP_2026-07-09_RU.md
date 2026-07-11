# Space Y: экранный план полного игрового цикла и техническая дорожная карта релиза

Дата: 2026-07-09  
Репозиторий: `/Users/irine/Desktop/SpaceY`  
Цель документа: зафиксировать, какие экраны нужны для полного цикла игры, что должно находиться на каждом экране, какие системы нужно добавить к текущей реализации и в каком порядке довести проект до релизного состояния.

Обновлено: 2026-07-11. Backend и server-authoritative game architecture теперь являются этапом 0, а не поздним улучшением. Архитектурный source of truth: `SPACEY_PRODUCTION_BACKEND_OPEN_API_ARCHITECTURE_2026-07-11_RU.md`.

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

## 8. Client state architecture

Текущий `game/store/shipStore.ts` остаётся временным источником данных только для development-прототипа и одноразового импорта legacy build schema v3.

Production-клиент может локально хранить:

- editor/UI selection, camera, audio и accessibility preferences;
- access token только в памяти;
- optimistic pending commands до server acknowledgement;
- interpolation buffer подтверждённых server snapshots.

Production-клиент не хранит authoritative build, wallet, inventory, mission result, reward, damage или progression. Эти данные загружаются через bootstrap API и меняются только server commands. Локальный wallet/result не импортируются.

## 9. Backend contract для релиза

Backend обязателен с этапа 0. Отдельный source of truth: `SPACEY_PRODUCTION_BACKEND_OPEN_API_ARCHITECTURE_2026-07-11_RU.md`.

Канонические контракты:

- `specs/player-public.openapi.yaml` — first-party и Public API;
- `specs/admin-private.openapi.yaml` — отдельный private admin API;
- `packages/protocol/asyncapi.yaml` — realtime события;
- `packages/protocol/proto` — Protobuf wire format.

Правило релиза:

- клиент отправляет только raw Telegram `initData`, build commands и realtime input;
- battle-worker создаёт результат и инициирует authoritative reward finalization;
- wallet, inventory, attempts, damage и progression принадлежат серверу;
- endpoint клиентского `complete/claim reward` отсутствует;
- production не имеет browser auth bypass или offline gameplay.

## 10. Техническая дорожная карта

### Этап 0. Security и platform foundation

- ротировать опубликованный Neon credential до первого подключения;
- хранить runtime/admin/migrator secrets только вне Git;
- pnpm/Turborepo, сервисные границы, CI и container scaffolds;
- HTTP/WS/Protobuf contracts и baseline PostgreSQL migrations;
- локальные Postgres/Valkey только для development и CI.

Готовность: frozen install, schema/contract validation, targeted tests и builds проходят без production secret; live DB не затрагивается.

### Этап 1. Identity, content и economy

- Telegram HMAC/auth-date/replay validation;
- rotating opaque refresh sessions и revoke model;
- profiles, content releases, server build revisions;
- inventory transitions, append-only wallet ledger, RLS и bootstrap API.

Готовность: forged/replayed auth отклоняется, а игрок не читает чужие данные и не может создать баланс.

### Этап 2. Deterministic simulation

- извлечь physics/AI/weapons/damage из `BattleCanvas`;
- удалить Pixi, DOM, clock и `Math.random` из simulation package;
- seeded RNG, fixed 30 Hz, input journal и state hashes.

Готовность: одинаковые versions/seed/build/inputs дают одинаковый replay hash.

### Этап 3. Battle worker и PvE

- одноразовый WS ticket, Protobuf snapshots 10 Hz;
- attempts, checkpoint каждые 2 секунды, reconnect и worker recovery;
- authoritative result/reward, replay metadata и object storage.
- persistent durability по pinned immutable build revision в той же result-транзакции; damaged ниже 70%, destroyed при 0, exactly-once transition.

Готовность: retry/reconnect/worker kill не удваивает reward и не меняет итог.

### Этап 4. Render-only client cutover

- заменить local battle authority на snapshot renderer;
- перевести build editor, mission board, result и first spend path на API;
- оставить development fallback только под явным non-production flag;
- разрешить одноразовый import legacy build v3 без wallet/results.

Готовность: production client bundle не содержит simulation, reward tables, Prisma или enemy AI.

### Этап 5. Realtime PvP

- matchmaking, MMR, opponent routing и seasons;
- neutral input/disconnect grace/forfeit;
- command validation, anti-cheat telemetry и replay review.

Source-level на 2026-07-11: реализованы MMR matchmaking, два независимых participant ticket/input stream, deterministic duel, checkpoint/reconnect, neutral input/forfeit, exactly-once result/MMR/module-damage finalization, consistent-hash session routing и render-only client flow. Не подтверждены staging PostgreSQL run, membership-change recovery rehearsal, packet-chaos и нагрузочный gate.

Готовность: packet loss/reorder/duplicates не ломают матч, а reconnect не создаёт вторую сессию.

### Этап 6. Admin, bot и Public API

- private admin-web/admin-api через Zero Trust/VPN и WebAuthn;
- audited content revisions, rollback-as-new-revision и economy ledger adjustment;
- Telegram bot lifecycle;
- scoped API keys/OAuth2, quotas, developer portal и signed webhooks.

Готовность: admin mutation и audit атомарны; Public API не предоставляет gameplay automation.

### Этап 7. Production hardening

- exact-SHA images, expand/contract migrations и health-gated blue/green;
- battle worker draining/recovery;
- OpenTelemetry, Sentry, alerts, backup/restore rehearsal;
- load gate 10k WS / 5k PvP с минимум 25% headroom.

Готовность: SLO и rollback rehearsal доказаны на staging; один VPS заменяется multi-node topology при провале load gate.

### Этап 8. Monetization

- Stars invoices только после economy audit;
- idempotent payment events, reconciliation и refunds;
- cosmetics/reward tracks без pay-to-win.

Готовность: duplicate/reordered Telegram events не удваивают purchase, refund корректно отражается в ledger.

## 11. Acceptance criteria для MVP

MVP можно считать настоящей игрой, когда:

- есть минимум 3 миссии;
- игрок выбирает миссию до боя;
- ангар показывает требования выбранной миссии;
- бой показывает objective progress;
- victory/failure зависит от objective;
- result показывает reward breakdown;
- reward сохраняется сервером ровно один раз;
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
- server-authoritative backend реализован и проверен на staging;
- production client не содержит gameplay/economy authority;
- Telegram auth, reconnect и idempotent reward покрыты security/integration tests;
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
| Поздний backend cutover | Закрепит небезопасную client authority | Backend — этап 0; UI строится поверх server contracts |
| Слишком много экранов сразу | Размоет фокус | MVP: contracts panel в `/hangar`, result overlay в `/battle` |
| Нет first spend path | Награды бессмысленны | Добавить repair или покупку common детали |
| Потеря деталей без blueprints | Игрок боится играть | Permanent blueprint progression до жестких потерь |
| Миссии не меняют билды | Space Y теряет ядро | Каждая миссия проверяет минимум 3 параметра сборки |
| UI перегружен | Mobile UX ломается | Делать progressive disclosure: board -> briefing -> diagnostics |
| LocalStorage economy | Нельзя выпускать production economy | Backend reward ledger перед soft launch |

## 14. Рекомендуемый порядок реализации экранов

1. `/hangar`: mission board panel.
2. `/hangar`: mission briefing drawer.
3. server bootstrap/build commands: selected mission и immutable build revision.
4. `/battle`: mission title, objective HUD и connection state.
5. `BattleCanvas`: snapshot renderer без authoritative runtime.
6. `/battle`: mission result overlay.
7. `/hangar`: wallet/resources strip.
8. `/hangar`: first spend path.
9. `/inventory`: минимальный parts vault.
10. `/contracts`: вынести mission board в отдельный экран, когда panel станет тесной.
11. `/repair`, `/market`, `/research`.
12. `/season`, `/profile`, `/social`.

Такой порядок сохраняет текущий рабочий `/hangar -> /battle`, но постепенно превращает его в полноценный игровой цикл.

## 15. Практический следующий патч

Следующий фундаментальный патч:

```text
Production Platform Foundation
```

Состав:

- monorepo/service границы и shared contracts;
- baseline PostgreSQL schema, RLS и migrations;
- Telegram auth/session foundation;
- deterministic simulation/protocol foundation;
- local/production infrastructure scaffolds и CI gates.

Не выполнять до ротации credential и staging-проверки:

- подключение опубликованного Neon URI;
- production migration;
- Stars payments;
- публичный rollout;
- объявление системы production-ready.

Цель патча: создать безопасную server-authoritative основу, после которой mission UI подключается к настоящим API, а не к новой локальной authority.
