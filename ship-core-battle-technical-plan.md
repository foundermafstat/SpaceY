# Space Y — технический план доработки ядра сборки корабля и боя

## 0. Контекст текущей реализации

План строится на текущей структуре проекта, а не на переписывании с нуля.

Проверенные точки:

- `game/types.ts` — текущие типы `FrameDef`, `PanelDef`, `ModuleDef`, `ShipBuild`, `ShipStats`.
- `game/data/frames.ts` — фреймы, размер сетки, `activeCells`, лимиты.
- `game/data/panels.ts` — панели, формы, connector ids `V1-V5` и `H1-H5`.
- `game/data/modules.ts` — core, hull, armor, engines, weapons, reactor, shield.
- `game/data/defaultBuild.ts` — стартовая сборка.
- `game/ship/build.ts` — установка панелей и модулей.
- `game/ship/stats.ts` — расчет HP, mass, thrust, energy, heat, shield, DPS.
- `game/store/shipStore.ts` — Zustand persist, установка/перемещение/удаление деталей.
- `app/hangar/page.tsx` — UI ангара, drag/drop, preview, статистика.
- `app/battle/page.tsx` — вход в бой и награда.
- `components/battle/BattleCanvas.tsx` — Pixi бой, движение, оружие, снаряды, враги, коллизии, VFX.
- `game/assets/moduleSprites.ts` — runtime atlas mapping.

Текущая модель:

```text
Frame
-> Panels
-> Modules
-> calculateShipStats
-> BattleCanvas
```

Целевая модель:

```text
Cabin
-> Panel layer
-> Element layer
-> Connector graph
-> Power / Heat / Structure networks
-> ShipRuntime
-> Combat systems
-> Part damage / detach / salvage
```

Главный принцип: внедрять V2 поэтапно, сохраняя рабочие `/hangar` и `/battle`.

---

## 1. Стабилизация текущего MVP перед расширением

### Цель

Сначала убрать технические риски, которые могут маскировать ошибки новой логики.

### Проблема

В текущем состоянии есть базовые несоответствия:

- `game/assets/moduleSprites.ts` ожидает `/assets/panels/panel-states-atlas.png`, но `public/assets/panels` сейчас отсутствует.
- `FrameDef.activeCells` есть в данных, но `canInstallPanel` проверяет только границы сетки и пересечения.
- В бою `buildShipGraphic`, `collectWeapons` и `getCollisionPoints` проходят по `module.shape.cells`, но не применяют `installed.rotation`.
- Урон идет в общий `hp`, а `shield`, `energy`, `heat` пока остаются в статах/предупреждениях.

### Решение

1. Восстановить или сгенерировать `public/assets/panels/panel-states-atlas.png`.
2. В `canInstallPanel` добавить проверку, что каждая transformed cell находится в `frame.activeCells`.
3. Вынести единый helper для transformed local cells и использовать его в:
   - `buildShipGraphic`;
   - `collectWeapons`;
   - `getCollisionPoints`;
   - будущих hit tests.
4. Не менять баланс и UI в этом пункте, только убрать расхождения.

### Тестирование после изменения

- Запустить целевой `npm run typecheck`.
- Открыть `/hangar`: панели должны отображаться, preview должен запрещать установку вне `activeCells`.
- Проверить ручной сценарий:
  - поставить длинную панель;
  - повернуть ее;
  - поставить модуль на панель;
  - перетащить модуль;
  - удалить панель с модулем сверху не должно получиться.
- Открыть `/battle`: повернутые модули должны совпадать визуально, по точкам коллизии и по позиции оружия.

---

## 2. Версионирование сборки и миграция данных

### Цель

Подготовить проект к переходу от `frame + modules` к `cabin + panels + elements`, не ломая сохранения в localStorage.

### Проблема

Сейчас `ShipBuild` хранится в Zustand persist под ключом `starframe-arena-ship`, version `2`. Если резко изменить форму:

```ts
frameId -> cabinId
modules -> elements
```

старые сохранения могут сломать `/hangar` и `/battle`.

### Решение

1. Ввести явное поле `schemaVersion` в `ShipBuild`.
2. Добавить `game/ship/migration.ts`.
3. Описать миграции:
   - V2 current: `frameId`, `panels`, `modules`;
   - V3 bridge: `frameId`, `cabinId?`, `panels`, `modules`, `elements?`;
   - V4 target: `cabinId`, `panels`, `elements`.
4. В `game/store/shipStore.ts` оставить совместимость:
   - если нет `schemaVersion`, считать это V2;
   - если нет `panels`, сбросить на `defaultBuild`;
   - если есть `modules`, временно маппить их в `elements` через compatibility layer.

### Тестирование после изменения

- Проверить старт с чистым localStorage.
- Проверить старт со старым сохранением V2.
- Проверить `resetBuild`.
- Проверить, что `/hangar` и `/battle` открываются после обновления persist version.
- Добавить минимальные unit-тесты на `migrateShipBuild`, если в проект будет добавлен test runner; до этого держать чистую TypeScript-проверку.

---

## 3. Новая доменная модель без удаления старой

### Цель

Создать типы для будущей архитектуры и начать перевод кода на них постепенно.

### Проблема

`ModuleDef` сейчас смешивает несколько ролей:

- core;
- hull;
- armor;
- engine;
- weapon;
- reactor;
- battery;
- shield;
- utility.

Из-за этого сложно отдельно валидировать установку, считать сети, повреждать конкретную часть и отключать runtime-поведение.

### Решение

В `game/types.ts` добавить новые типы рядом со старыми:

- `CabinDef`;
- `ElementDef`;
- `PanelRole`;
- `ElementRole`;
- `MountSlot`;
- `NetworkType`;
- `ConnectorFamily`;
- `ShipBuildV2`;
- `ShipStatsV2`;
- `ShipTopologyGraph`;
- `RuntimePartState`.

Важно: на первом шаге не удалять `ModuleDef`, `FrameDef` и `ShipBuild`. Старый код должен продолжить работать.

Предлагаемый переход:

```text
FrameDef -> CabinDef compatibility
ModuleDef -> ElementDef compatibility
ShipBuild -> ShipBuildV2 through migration
calculateShipStats -> calculateShipStatsV2 with fallback wrapper
```

### Тестирование после изменения

- `npm run typecheck`.
- Проверить, что старый `defaultBuild` компилируется.
- Проверить, что старые `moduleDefs` можно преобразовать в `ElementDef` без потери текущих полей.
- Проверить, что новые типы не требуют изменения UI до следующих этапов.

---

## 4. Кабины вместо core/frame

### Цель

Сделать кабину центром корабля: она задает сетку, стартовую форму, лимиты, экипаж, базовую энергию и роль корабля.

### Проблема

Сейчас смысл корабля разделен между:

- `FrameDef` в `game/data/frames.ts`;
- `core_mk1` в `game/data/modules.ts`;
- предупреждением `"Core module required"` в `calculateShipStats`.

Это создает конфликт: core является обычным модулем, но должен быть обязательной центральной частью корабля.

### Решение

1. Создать `game/data/cabins.ts`.
2. Перенести смысл `scout_frame` в первую кабину `solo_pod_mk1`.
3. Оставить `FrameDef` как compatibility wrapper на один этап:

```text
CabinDef.gridSize -> FrameDef.size
CabinDef.activeCells -> FrameDef.activeCells
CabinDef.panelLimit -> FrameDef.maxModules or new limit
CabinDef.maxMass -> FrameDef.maxMass
```

4. В `defaultBuild` добавить `cabinId`, но временно оставить `frameId`.
5. `core_mk1` перевести в legacy-модуль или удалить из обязательных проверок только после появления cabin runtime.
6. В ангаре заменить подпись `frame.name` на cabin name после включения V2.

### Тестирование после изменения

- Старый `/hangar` должен открываться с тем же визуальным размером сетки.
- Сборка без `core_mk1`, но с `cabinId`, не должна получать предупреждение `Core module required`.
- Сборка без `cabinId` должна мигрировать или сбрасываться.
- В `/battle` HP и mass должны учитывать кабину один раз, без двойного учета `frame.baseHp` и `core_mk1.hp`.

---

## 5. Panel layer V2: роли, mount slots и сети

### Цель

Сделать панели не просто визуальной подложкой, а физическим корпусом корабля и основой сетей.

### Проблема

Текущий `PanelDef` содержит:

- shape;
- connectors;
- mass;
- hp;
- sprite;
- tags.

Но панели не говорят, какие элементы на них можно ставить. Поэтому `canInstallModule` проверяет только наличие панели под модулем и пересечение клеток.

### Решение

Расширить `PanelDef`:

- `role`: `hull`, `armor`, `weapon_mount`, `engine_mount`, `utility_mount`, `cargo_floor`, `heat_sink`, `power_bus`, `adapter`, `spine`;
- `mountSlots`: список точек установки;
- `networks`: какие сети проводит панель;
- `external`: можно ли ставить наружные элементы;
- `armorClass`;
- `detachResistance`;
- `allowedElementRoles`.

Пример правил:

- weapon можно ставить только на `weapon_mount` или universal mount;
- engine можно ставить на `engine_mount`;
- radiator эффективен только на external panel;
- cargo можно ставить на `cargo_floor`;
- reactor должен иметь доступ к `power` network.

### Тестирование после изменения

- В `/hangar` preview должен показывать invalid для оружия на обычной панели.
- Двигатель на engine mount должен ставиться.
- Reactor на панели без power network должен давать blocker или warning, в зависимости от выбранного правила MVP.
- Проверить rotation панели: mount slots должны поворачиваться вместе с панелью.
- Проверить drag/drop: перенос панели с mount slots не должен ломать уже стоящие элементы.

---

## 6. Element layer V2 вместо modules

### Цель

Переименовать функциональные устройства в элементы и отделить их от корпуса.

### Проблема

Сейчас `ModuleDef` одновременно описывает структурные блоки и функциональные устройства. После появления panel layer hull/armor должны быть ролью панели, а engine/weapon/reactor/shield должны стать элементами.

### Решение

1. Создать `game/data/elements.ts`.
2. Перенести из `moduleDefs` функциональные детали:
   - `ion_engine`;
   - `plasma_thruster`;
   - `side_thruster`;
   - `small_reactor`;
   - `autocannon`;
   - `laser_turret`;
   - `plasma_cannon`;
   - `missile_pod`;
   - `shield_generator`.
3. Hull/armor постепенно перевести в panel roles.
4. Ввести `ElementRole`:
   - `engine`;
   - `maneuver_thruster`;
   - `weapon`;
   - `reactor`;
   - `battery`;
   - `shield`;
   - `radiator`;
   - `cargo`;
   - `scanner`;
   - `drill`;
   - `utility`.
5. Сохранить compatibility:
   - `getModule(id)` продолжает работать для старого UI;
   - новый `getElement(id)` используется новыми сервисами.

### Тестирование после изменения

- Старые карточки в ангаре должны отображаться.
- Временный compatibility list должен возвращать те же элементы, что старый `moduleDefs`.
- `calculateShipStats` и `calculateShipStatsV2` на стартовой сборке должны давать близкие значения для HP, mass, thrust и DPS до включения новых механик.

---

## 7. ShipBuildValidator V2

### Цель

Сделать единый валидатор сборки для ангара, миграций и запуска боя.

### Проблема

Сейчас правила разбросаны:

- `canInstallPanel`;
- `canInstallModule`;
- `shipStore` повторно защищает удаление панелей;
- `calculateShipStats` выдает warnings.

Из-за этого легко получить сборку, которая визуально разрешена, но runtime-логически неработоспособна.

### Решение

Создать `game/ship/validation.ts`:

- `validatePanelPlacement`;
- `validateElementPlacement`;
- `validateWholeBuild`;
- `getBuildBlockers`;
- `getBuildWarnings`;
- `getBuildHints`.

Разделить результаты:

- hard blockers: нельзя сохранить/запустить бой;
- warnings: можно, но эффективность снижена;
- hints: подсказки по улучшению.

MVP blockers:

- нет кабины;
- панель вне `activeCells`;
- panel overlap;
- connector mismatch;
- element без панели;
- element не на подходящем mount slot;
- element overlap;
- weapon/reactor/engine limits exceeded;
- сборка разорвана от кабины по structure network.

MVP warnings:

- отрицательный energy balance;
- высокий heat load;
- mass выше recommended;
- нет shield;
- мало maneuver thrust;
- оружие без достаточного power priority.

### Тестирование после изменения

- Для каждого blocker сделать маленький fixture build.
- Проверить, что `/hangar` использует тот же валидатор для preview.
- Проверить, что `/battle` не запускает build с hard blockers или явно показывает причину.
- Проверить, что warnings не ломают старые рабочие сборки.

---

## 8. ShipTopologyGraph

### Цель

Ввести граф соединений корабля, чтобы сборка стала системой, а не набором клеток.

### Проблема

Connector ids у панелей уже есть, но они используются только при установке новой панели. После установки нет единой структуры, которая отвечает на вопросы:

- какие панели связаны с кабиной;
- какие элементы получают power;
- куда уходит heat;
- какие детали отвалятся при разрушении панели;
- какие части корабля изолированы.

### Решение

Создать `game/ship/topology.ts`.

Граф должен строиться из:

- cabin cells;
- panel cells;
- panel connectors;
- mount slots;
- elements;
- network capabilities.

Минимальные методы:

- `buildShipTopology(build)`;
- `getConnectedPanelsFromCabin`;
- `getElementNetworkAccess(elementInstanceId)`;
- `isPanelConnectedToCabin`;
- `getDetachedGroupsAfterPartDestroyed`;
- `getNetworkLoad(networkType)`.

### Тестирование после изменения

- Fixture: одна линия панелей от кабины, все connected.
- Fixture: панель без matching connector, должна быть disconnected.
- Fixture: reactor на connected panel питает weapon.
- Fixture: reactor на isolated panel не питает weapon.
- Fixture: уничтожение центральной панели делит корабль на группы.

---

## 9. ShipStats V2

### Цель

Считать не только агрегаты, но и физику/эффективность корабля.

### Проблема

Текущий `calculateShipStats` считает:

- hp;
- shield;
- mass;
- thrust;
- acceleration;
- maxSpeed;
- turnRate;
- energyBalance;
- heat;
- dps.

Но не учитывает:

- центр массы;
- момент инерции;
- направление двигателей;
- расположение оружия;
- локальные сети;
- runtime-отключения.

### Решение

Создать `game/ship/statsV2.ts`.

Добавить поля:

- `centerOfMass`;
- `momentOfInertia`;
- `mainThrust`;
- `reverseThrust`;
- `lateralThrust`;
- `torque`;
- `brakingPower`;
- `driftFactor`;
- `stability`;
- `powerOutput`;
- `powerStorage`;
- `powerDemand`;
- `heatGeneration`;
- `heatDissipation`;
- `shieldCapacity`;
- `shieldRegen`;
- `weaponDpsByType`;
- `disabledPartsImpact`.

Старый `calculateShipStats` оставить wrapper-ом для UI до обновления всех экранов.

### Тестирование после изменения

- Стартовая сборка должна иметь валидные числовые stats без `NaN`.
- Удаление двигателя должно снижать `mainThrust` и `maxSpeed`.
- Перенос двигателя вбок должен менять `torque`/`stability`.
- Добавление тяжелой панели на край должно смещать `centerOfMass`.
- Установка лишнего оружия должна увеличивать `powerDemand` и `heatGeneration`.

---

## 10. ShipRuntimeFactory

### Цель

Создать runtime-представление корабля для боя, не зависящее напрямую от UI-сборки.

### Проблема

`BattleCanvas.tsx` сейчас сам:

- читает `ShipBuild`;
- создает визуал;
- собирает weapons;
- считает collision points;
- хранит общий HP;
- применяет урон.

Это делает добавление modular damage, shields, heat и energy слишком рискованным.

### Решение

Создать `game/ship/runtime.ts`:

- `createShipRuntime(build, stats, topology)`;
- `RuntimePart`;
- `RuntimeWeapon`;
- `RuntimeEngine`;
- `RuntimeShield`;
- `RuntimeEnergyState`;
- `RuntimeHeatState`.

Runtime должен содержать:

- список частей с hp/state;
- локальные координаты частей;
- world transform helpers;
- active weapons;
- active engines;
- текущий shield pool;
- текущую energy storage;
- текущий heat;
- derived stats после повреждений.

### Тестирование после изменения

- Runtime стартовой сборки должен содержать все панели и элементы.
- Количество runtime weapons должно совпадать с установленным оружием.
- Runtime engines должны иметь mount position и direction.
- Повреждение части должно менять ее state, но не мутировать исходный `ShipBuild`.

---

## 11. Разделение BattleCanvas на системы

### Цель

Снизить риск изменений в бою, вынося поведение из одного большого файла по слоям.

### Проблема

`components/battle/BattleCanvas.tsx` содержит и React lifecycle, и Pixi setup, и движение, и оружие, и врагов, и VFX, и коллизии. Это допустимо для MVP, но плохо для следующего этапа.

### Решение

Выносить постепенно, по одному патчу:

1. `game/battle/math.ts`:
   - vectors;
   - rotation;
   - `getWorldMount`;
   - clamp helpers.
2. `game/battle/shipPhysics.ts`:
   - `applyShipPhysics`;
   - V2 movement later.
3. `game/battle/collision.ts`:
   - `getCollisionPoints`;
   - `projectileHitsShip`;
   - ship-vs-ship collision.
4. `game/battle/weapons.ts`:
   - collect weapons;
   - cooldown update;
   - projectile creation data.
5. `game/battle/damage.ts`:
   - shield absorption;
   - part damage;
   - hull fallback.

React component остается владельцем canvas lifecycle и Pixi containers.

### Тестирование после изменения

- После каждого вынесения запускать `npm run typecheck`.
- Открыть `/battle` и проверить:
  - player movement;
  - enemy movement;
  - auto-fire;
  - projectiles;
  - victory/defeat.
- Сравнить поведение до/после: первый этап refactor должен быть behavior-preserving.

---

## 12. Movement V2: масса, инерция, центр массы, тяга

### Цель

Сделать так, чтобы сборка реально ощущалась в управлении.

### Проблема

Сейчас `applyShipPhysics` использует:

```text
acceleration
maxSpeed
turnRate
friction 0.99
```

Но не учитывает расположение двигателей, центр массы, боковую тягу, торможение и момент инерции.

### Решение

1. В stats V2 считать engine vectors.
2. У каждого engine element задать:
   - thrust vector;
   - reverse thrust;
   - lateral thrust;
   - spool time;
   - energy draw per second;
   - heat per second.
3. В `shipPhysics.ts` перейти к runtime input:

```text
inputVector
-> requested thrust
-> available engine groups
-> power efficiency
-> heat penalty
-> force
-> torque
-> velocity
-> angularVelocity
```

4. Добавить damping отдельно:
   - linear drag;
   - angular drag;
   - braking when reverse thrusters exist.

### Тестирование после изменения

- Два одинаковых двигателя сзади: корабль летит ровно.
- Один двигатель слева/справа: появляется torque или снижается stability.
- Тяжелая сборка разгоняется медленнее легкой.
- Боковые thrusters улучшают поворот.
- При удалении двигателя в runtime корабль должен заметно терять управляемость.

---

## 13. EnergySystem

### Цель

Сделать энергию runtime-ресурсом, а не только числом в ангаре.

### Проблема

Сейчас `energyProduction`, `energyConsumption` и `energyBalance` считаются, но:

- оружие стреляет при любом балансе;
- shield не потребляет энергию;
- двигатели не просаживаются;
- батарейный buffer отсутствует.

### Решение

Создать `game/battle/systems/EnergySystem.ts`.

Runtime поля:

- `capacity`;
- `current`;
- `generationPerSecond`;
- `baseLoad`;
- `priorityLoads`;
- `brownoutLevel`.

Приоритеты:

1. cabin/life support;
2. engines;
3. shields;
4. weapons;
5. utility.

Поведение:

- если energy достаточно, все работает штатно;
- если energy не хватает, низкие приоритеты получают efficiency penalty;
- оружие может пропускать выстрел;
- shield regen замедляется;
- engine thrust снижается.

### Тестирование после изменения

- Сборка с положительным energy balance стреляет и двигается штатно.
- Сборка с отрицательным energy balance теряет fire rate или shield regen.
- Установка батареи увеличивает время до brownout.
- HUD боя должен показывать energy или хотя бы debug indicator на первом этапе.

---

## 14. HeatSystem

### Цель

Сделать тепло ограничителем агрессивных сборок.

### Проблема

Сейчас `heat` считается как `generation - dissipation`, но не влияет на бой.

### Решение

Создать `game/battle/systems/HeatSystem.ts`.

Runtime поля:

- `currentHeat`;
- `heatCapacity`;
- `generationByPart`;
- `dissipationByPanel`;
- `overheatThreshold`;
- `cooldownThreshold`.

Поведение:

- weapons добавляют heat per shot;
- engines/reactors добавляют heat per second;
- radiators/heat sink panels снижают heat;
- при overheat часть получает state `overheated`;
- overheated weapon временно не стреляет;
- overheated reactor снижает generation;
- extreme heat наносит damage nearby parts.

### Тестирование после изменения

- Laser/plasma build без cooling перегревается.
- Autocannon build греется слабее.
- Radiator снижает heat accumulation.
- Overheated weapon возвращается в строй после охлаждения.
- Heat warning в ангаре соответствует поведению в бою.

---

## 15. ShieldSystem

### Цель

Сделать shield отдельным pool с regen, delay и VFX.

### Проблема

`calculateShipStats` считает shield capacity, но в `BattleCanvas` урон сразу снимается с `hp`.

### Решение

Создать `game/battle/systems/ShieldSystem.ts`.

Runtime поля:

- `capacity`;
- `current`;
- `regenPerSecond`;
- `regenDelay`;
- `radius`;
- `damageMultipliers`;
- `isOnline`.

Поведение:

- входящий урон сначала идет в shield;
- после попадания включается regen delay;
- EMP снижает shield или отключает regen;
- explosive/kinetic/energy получают разные multipliers;
- при shield hit вызывается `shieldImpact` VFX.

### Тестирование после изменения

- Корабль со shield получает сначала shield damage, HP не падает.
- После паузы shield восстанавливается.
- При EMP shield проседает сильнее или отключается.
- Без shield урон идет сразу в parts/hull.
- В `/battle` визуально видно shield impact.

---

## 16. WeaponSystem V2

### Цель

Сделать оружие data-driven и связать fire rate с energy, heat, rotation, mount direction и damage model.

### Проблема

Сейчас weapons собираются в `collectWeapons`, cooldown прост, а попадание:

- energy beam сразу снимает HP;
- projectiles снимают HP при hit;
- `aoeRadius`, `piercing`, `knockback` почти не используются.

### Решение

1. Расширить `WeaponDef`:
   - `category`;
   - `burst`;
   - `reload`;
   - `spread`;
   - `tracking`;
   - `arc`;
   - `minRange`;
   - `powerPriority`;
   - `heatProfile`;
   - `damageFalloff`.
2. Создать `RuntimeWeaponState`:
   - cooldown;
   - reload;
   - heat;
   - disabled;
   - target lock.
3. В `WeaponSystem` использовать:
   - energy efficiency;
   - heat status;
   - turret turn speed;
   - line/arc restrictions.
4. Реализовать эффекты:
   - kinetic: точечный part damage;
   - explosive: splash по нескольким parts;
   - energy: shield efficient, lower armor damage;
   - plasma/thermal: heat + damage;
   - EMP: shield/energy disruption;
   - piercing: проход через несколько parts.

### Тестирование после изменения

- Autocannon стабильно стреляет по ближайшей цели.
- Plasma применяет splash через `aoeRadius`.
- Laser/energy не создает projectile, но проходит через shield logic.
- Missile медленнее, но с explosion VFX.
- Weapon без энергии пропускает выстрелы.
- Перегретое weapon временно disabled.

---

## 17. Collision V2 и hit resolution

### Цель

Попадание должно возвращать конкретную часть корабля, а не только boolean.

### Проблема

Текущий `projectileHitsShip` возвращает `true/false` по collision points. Нельзя понять:

- куда попали;
- какая панель или элемент повреждены;
- был ли hit по shield;
- какие части задеты splash damage.

### Решение

В `game/battle/collision.ts` сделать:

- `getRuntimeCollisionShapes(shipRuntime)`;
- `findHitPart(projectile, shipRuntime)`;
- `findPartsInRadius(center, radius, shipRuntime)`;
- `resolveShipOverlap`.

Collision shape должен включать:

- panel cells;
- element cells;
- cabin cells;
- local/world transform;
- part instance id.

### Тестирование после изменения

- Projectile hit по engine возвращает engine part id.
- Hit по panel без element возвращает panel part id.
- Splash рядом с двумя частями возвращает обе.
- Повернутый корабль имеет корректные world collision points.
- Повернутый установленный элемент учитывает собственную rotation.

---

## 18. DamageSystem V2: урон по деталям

### Цель

Сделать разрушение деталей основой боя.

### Проблема

Сейчас бой заканчивается по общему HP. Это не дает геймплейных последствий от состава корабля.

### Решение

Создать `game/battle/systems/DamageSystem.ts`.

Порядок обработки:

```text
incoming damage
-> shield absorption
-> armor mitigation
-> hit part selection
-> part hp reduction
-> state update
-> disabled/destroyed/detached
-> stats/runtime recalculation
-> VFX/audio
```

Part states:

- `ideal`;
- `lightDamage`;
- `heavyDamage`;
- `disabled`;
- `destroyed`;
- `detached`.

Критические правила:

- destroyed engine убирает thrust;
- destroyed weapon перестает стрелять;
- destroyed reactor снижает energy generation;
- destroyed shield generator отключает shield;
- destroyed cabin ведет к defeat;
- destroyed connector panel может оторвать группу деталей.

### Тестирование после изменения

- Уничтожить weapon врага: оно перестает стрелять.
- Уничтожить engine врага: движение ухудшается.
- Уничтожить shield generator: shield исчезает.
- Уничтожить reactor: weapons/engines получают energy penalty.
- Уничтожить cabin: бой заканчивается.

---

## 19. PartDetachSystem

### Цель

Реализовать отрыв частей после разрушения несущих панелей.

### Проблема

Даже если ввести part HP, без topology graph уничтоженная панель не изменит структуру корабля.

### Решение

Создать `game/battle/systems/PartDetachSystem.ts`.

После разрушения panel/cabin connector:

1. Перестроить topology graph.
2. Найти группы, не связанные с cabin.
3. Пометить их `detached`.
4. Убрать их из active systems.
5. Создать debris entities с текущей velocity.
6. Пересчитать runtime stats.

### Тестирование после изменения

- Разрушение боковой панели с оружием отрывает оружие.
- Detached weapon не стреляет.
- Detached engine не дает thrust.
- Debris визуально улетает и не остается частью ship collision.
- Если разрушена декоративная крайняя панель без элементов, корабль продолжает работать.

---

## 20. Враги на той же runtime-модели

### Цель

Убрать разрыв между игроком и врагами: оба должны использовать ShipBuild/ShipRuntime.

### Проблема

Сейчас враги создаются в `makeEnemyBuild` прямо внутри `BattleCanvas.tsx`. Это удобно для MVP, но мешает:

- damage по деталям врага;
- разным enemy archetypes;
- балансу;
- будущим наградам за salvage.

### Решение

1. Создать `game/data/enemies.ts`.
2. Описать enemy builds через те же cabin/panels/elements.
3. `makeEnemy` должен получать enemy def и создавать `ShipRuntime`.
4. Enemy AI должен использовать runtime stats:
   - скорость;
   - weapon range;
   - shield state;
   - damaged engines.

### Тестирование после изменения

- Drone, raider, bomber появляются как раньше.
- У каждого врага есть parts.
- Уничтожение weapon у врага снижает его threat.
- Уничтожение engine меняет его движение.
- Victory срабатывает, когда enemy cabin destroyed или runtime считается dead.

---

## 21. Hangar UI V2

### Цель

Показать игроку, почему сборка работает или не работает.

### Проблема

Сейчас ангар показывает:

- mini stats;
- panel/module tabs;
- energy balance в drawer;
- preview valid/invalid.

Но не объясняет:

- mount slot compatibility;
- сеть power/heat;
- центр массы;
- shield/energy/heat consequences;
- какие blockers не пускают в бой.

### Решение

Добавить в `app/hangar/page.tsx` постепенно:

1. Build status panel:
   - blockers;
   - warnings;
   - hints.
2. Layer overlays:
   - structure;
   - power;
   - heat;
   - weapon arcs;
   - engine vectors;
   - center of mass.
3. Tooltips/cards деталей:
   - role;
   - mount requirements;
   - energy draw;
   - heat;
   - mass;
   - HP.
4. Disable `Test Battle`, если есть hard blockers.

### Тестирование после изменения

- Невалидная сборка показывает конкретную причину.
- Валидная сборка пускает в бой.
- Overlay power показывает connected и disconnected элементы.
- Engine vector overlay меняется при повороте двигателя.
- Center of mass смещается при добавлении тяжелой детали.

---

## 22. Asset/VFX pipeline для новых состояний

### Цель

Подготовить визуалы под modular damage и runtime systems.

### Проблема

Сейчас уже есть state atlases для modules/weapons, но panel atlas отсутствует в checkout. Новая модель требует больше визуальных состояний:

- ideal;
- light damage;
- heavy damage;
- debris/detached;
- overheated;
- shield hit;
- engine thrust intensity;
- explosion/smoke/debris.

### Решение

1. Восстановить документ методологии ассетов в текущей структуре проекта, если он должен быть source of truth.
2. Восстановить `panel-states-atlas.png`.
3. Для новых elements придерживаться atlas + manifest подхода.
4. Не запекать engine flame в сам engine sprite: thrust должен быть runtime VFX.
5. Weapon base и turret держать отдельно.

### Тестирование после изменения

- Все atlas paths из `game/assets/moduleSprites.ts` реально существуют.
- `/hangar` отображает panels.
- `/battle` отображает ideal/light/heavy/debris states.
- Engine VFX появляется только при thrust.
- Shield impact VFX появляется только при shield hit.

---

## 23. Сохранение минимального playable milestone

### Цель

После каждого этапа игра должна оставаться запускаемой.

### Проблема

Если одновременно внедрить cabins, elements, runtime graph, systems и UI, высок риск сломать весь прототип.

### Решение

Делить работу на небольшие milestones:

1. Stabilization.
2. Types + migration.
3. Cabin compatibility.
4. Panel mount slots.
5. Element compatibility.
6. Validator V2.
7. Stats V2.
8. Runtime factory.
9. Battle extraction.
10. Movement V2.
11. Energy/heat/shield.
12. Modular damage.
13. Detach.
14. Enemy runtime.
15. Hangar overlays.

Каждый milestone должен иметь один явный результат в игре.

### Тестирование после изменения

Для каждого milestone:

- `npm run typecheck`;
- ручной smoke `/hangar`;
- ручной smoke `/battle`;
- один сценарий, который доказывает новую механику.

Полный `npm run build` запускать только перед крупной интеграцией или релизной проверкой.

---

## 24. Рекомендуемый порядок первых патчей

### Патч 1. Стабилизация панели и rotation

Файлы:

- `public/assets/panels/panel-states-atlas.png`;
- `game/ship/build.ts`;
- `components/battle/BattleCanvas.tsx`.

Результат:

- панели отображаются;
- нельзя ставить панели вне `activeCells`;
- rotation установленного модуля учитывается в battle visual/collision/mounts.

Проверка:

- `npm run typecheck`;
- `/hangar`;
- `/battle`.

### Патч 2. Типы V2 и миграция

Файлы:

- `game/types.ts`;
- `game/ship/migration.ts`;
- `game/store/shipStore.ts`;
- `game/data/defaultBuild.ts`.

Результат:

- сборки получают `schemaVersion`;
- старые сохранения открываются;
- готов мост к `cabinId`.

Проверка:

- чистый localStorage;
- старый localStorage;
- reset build.

### Патч 3. CabinDef compatibility

Файлы:

- `game/data/cabins.ts`;
- `game/ship/build.ts`;
- `game/ship/stats.ts`;
- `app/hangar/page.tsx`.

Результат:

- cabin становится источником сетки и базовых характеристик;
- `core_mk1` перестает быть обязательным системным центром.

Проверка:

- сборка с cabin без core валидна;
- stats не удваивают HP/mass;
- `/battle` использует cabin-based stats.

### Патч 4. Mount slots и validator

Файлы:

- `game/types.ts`;
- `game/data/panels.ts`;
- `game/ship/validation.ts`;
- `game/ship/build.ts`;
- `app/hangar/page.tsx`.

Результат:

- weapon/engine/reactor ставятся только на допустимые панели;
- preview использует единый валидатор.

Проверка:

- weapon на обычную панель invalid;
- engine на engine mount valid;
- reactor без power network warning/blocker.

### Патч 5. Runtime factory и shield

Файлы:

- `game/ship/runtime.ts`;
- `game/battle/systems/ShieldSystem.ts`;
- `components/battle/BattleCanvas.tsx`.

Результат:

- shield получает отдельный pool;
- входящий урон сначала снимает shield;
- HP падает только после пробития shield.

Проверка:

- бой со shield;
- бой без shield;
- shield impact VFX.

---

## 25. Критерии готовности результата

Система считается эффективной и работоспособной, когда:

- игрок может собрать корабль в `/hangar`;
- валидатор объясняет, почему часть нельзя поставить;
- характеристики меняются от формы, массы, двигателей и энергии;
- `/battle` использует ту же сборку, что ангар;
- shield, energy и heat влияют на бой;
- попадания повреждают конкретные детали;
- уничтожение деталей меняет поведение корабля;
- враги используют те же правила, что игрок;
- после каждого milestone есть понятный ручной сценарий проверки.

---

## 26. Основные риски

- Слишком раннее удаление старых `FrameDef`/`ModuleDef` сломает текущий MVP.
- Одновременная переработка ангара и боя усложнит отладку.
- Modular damage без topology graph даст визуальный урон, но не настоящие последствия.
- Energy/heat без UI объяснения будет выглядеть как случайное ухудшение поведения.
- Asset pipeline нужно восстановить до массовой генерации новых деталей.

Главная рекомендация: идти через compatibility layer и проверять каждый этап в живых маршрутах `/hangar` и `/battle`.
