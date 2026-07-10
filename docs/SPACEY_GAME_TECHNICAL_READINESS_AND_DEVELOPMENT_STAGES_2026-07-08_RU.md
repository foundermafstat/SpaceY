# Space Y: техническая готовность и этапы разработки

Дата: 2026-07-08
Репозиторий: `/Users/irine/Desktop/SpaceY`
Ветка/HEAD на момент проверки: `main` / `729eb3d`
Снимок: текущий working tree, не чистый commit.

## 1. Краткий вердикт

Space Y сейчас находится на стадии сильного клиентского vertical prototype, но еще не на стадии полноценной игры.

Главное уже доказано:

- игрок может собрать корабль в ангаре;
- сборка влияет на характеристики;
- корабль выходит в локальный бой;
- есть ручное управление движением и автоматическое оружие;
- есть враги, снаряды, щиты, энергия, тепло, повреждения частей, VFX и аудио;
- `/hangar` и `/battle` проходят smoke-проверку.

Главное еще не закрыто:

- нет настоящих миссий/контрактов;
- нет выбора задания перед боем;
- нет objective engine;
- нет полноценного post-battle результата;
- нет инвентаря, ремонта, research, market, crafting;
- нет backend-авторитетности и аккаунта;
- нет Telegram Mini App/social loop;
- награда сейчас сведена к локальному `+65 scrap` за победу.

Итоговая оценка:

| Слой | Готовность | Комментарий |
| --- | ---: | --- |
| Игровая идея и документация | 80% | GDD, миссии, экономика, viral и battle pass описаны подробно. |
| Клиентский прототип | 65% | Рабочие маршруты, Pixi-сцены, ангар, бой. |
| Сборка корабля | 70% | Кабины, панели, коннекторы, модули, валидатор, пресеты. |
| Боевая песочница | 65% | Survival Test playable, но это еще не миссия. |
| Короткий игровой цикл | 35% | Есть "собрал -> тестовый бой -> scrap", нет "выбрал задание -> выполнил цель". |
| Длинный игровой цикл | 10% | Документирован, но почти не реализован. |
| Экономика/инвентарь | 5% | Есть только локальный `scrap`. |
| Backend/production | 0% | Все состояние локальное, награды не авторитетны. |
| QA/автотесты | 30% | TypeScript, asset validation, smoke; нет unit/integration/e2e покрытия. |

Общий вывод: проект технически готов к следующему шагу - закрытию короткого mission loop. До MVP-игры нужно добавить слой заданий, наград, инвентаря и минимальной прогрессии.

## 2. Что проверено

Документация:

- `design-doc.md`;
- `design-doc2.md`;
- `game-technical-document.md`;
- `ship-core-battle-technical-plan.md`;
- `ship-core-battle-milestone-execution-report.md`;
- `freetoplay.md`;
- `battlepass.md`;
- `viral.md`;
- `image-asset-generation-methodology.md`.

Кодовые поверхности:

- `app/page.tsx`;
- `app/hangar/page.tsx`;
- `app/battle/page.tsx`;
- `components/battle/BattleCanvas.tsx`;
- `game/types.ts`;
- `game/store/shipStore.ts`;
- `game/ship/build.ts`;
- `game/ship/validation.ts`;
- `game/ship/statsV2.ts`;
- `game/ship/runtime.ts`;
- `game/ship/topology.ts`;
- `game/battle/systems/*`;
- `game/data/defaultBuild.ts`;
- `game/data/shipPresets.ts`;
- `game/data/cabins.ts`;
- `game/data/panels.ts`;
- `game/data/modules.ts`;
- `game/data/enemies.ts`;
- `game/assets/moduleSprites.ts`;
- `scripts/validate-asset-pipeline.mjs`;
- `scripts/smoke-playable.mjs`.

Проверки:

| Проверка | Результат |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` через bundled Node | Passed |
| `node scripts/validate-asset-pipeline.mjs` | Passed, 114 paths checked |
| `scripts/smoke-playable.mjs` против уже запущенного `localhost:3000` | Passed: `/hangar`, `/battle` |
| `pnpm run typecheck` | Не дошел до TypeScript из-за pnpm policy: `Ignored build scripts: sharp@0.34.5` |

Важно: `node/npm` не доступны из обычного shell PATH, проверки запускались через bundled Codex Node.

## 3. Фактическая реализованная игра

Текущая фактическая петля:

```text
Открыть ангар
-> выбрать кабину / панели / модули
-> собрать корабль
-> увидеть blockers / warnings / hints
-> нажать Test Battle
-> попасть в Survival Test
-> уничтожить 4 AI-врага или проиграть
-> при победе получить +65 local scrap
-> вернуться в ангар
```

Это playable prototype, но еще не mission game.

## 4. Реализованные системы

### 4.1. Ангар и сборка

Уже есть:

- режимы сборки `cabins`, `panels`, `modules`;
- 11 player cabin variants на базе `cabins-v2`;
- установка и перемещение кабины;
- установка панелей по active cells;
- connector matching между панелями;
- запрет overlap с кабиной, панелями и модулями;
- установка модулей только на панельные клетки;
- проверка совместимости роли панели и роли элемента;
- power-network requirement для реактора;
- drag/drop из палитры и уже установленных частей;
- zoom/pan;
- overlays: structure, power, heat, weapons, engines, mass;
- build status: blockers, warnings, hints;
- 4 пресета корабля.

Сильная сторона: игрок уже видит, что корабль является инженерной конструкцией, а не просто набором статов.

Ограничения:

- нет стоимости установки;
- нет инвентарного количества деталей;
- `panelLimit` у кабин описан, но фактически лимиты установки завязаны на frame `maxModules`;
- sockets модулей существуют, но установка в основном проверяет `allowedElementRoles`, а не полноценную socket/orientation систему;
- нет mission-specific requirements;
- нет сохраненных build slots как мета-системы.

### 4.2. Статы и топология

Уже есть:

- `calculateShipStatsV2`;
- масса, HP, DPS, shield capacity, shield regen;
- center of mass;
- moment of inertia;
- engine vectors;
- main/reverse/lateral thrust;
- torque, braking, drift, stability;
- power output/storage/demand;
- heat generation/dissipation;
- weapon DPS by damage type;
- network load;
- disconnected parts;
- topology graph от кабины к панелям и элементам.

Сильная сторона: база для миссионных требований уже есть. Например, можно быстро добавить checks вида `minMobility`, `minShield`, `minHeatStability`, `requiredTags`.

Ограничения:

- статы не переведены в понятные mission diagnostics;
- нет cargo/mining/scan/tow/repair/rescue capacity;
- нет балансовой таблицы сложности миссий;
- нет серверной валидации сборки.

### 4.3. Бой

Уже есть:

- Pixi battle canvas;
- player ship из текущей сборки;
- 4 AI-врага: 2 drone, 1 raider, 1 bomber;
- joystick movement;
- масса, тяга, энергия и heat penalty влияют на поведение;
- автооружие;
- kinetic, energy, plasma, explosive damage;
- projectiles, beams, missile-like projectiles;
- shield pool и shield regen;
- energy brownout;
- heat/overheat;
- runtime part damage;
- disabling/detach логика;
- hit part detection;
- ship-vs-ship и projectile-vs-ship collision;
- enemy markers;
- parallax background, VFX, аудио;
- victory/defeat result.

Сильная сторона: прототип уже проверяет центральную фантазию "моя сборка летает и стреляет".

Ограничения:

- бой всегда `Survival Test`;
- нет MissionDef, objective progress и mission result model;
- враги фиксированы, нет wave budget/spawn table по миссии;
- mission rewards не зависят от цели, риска, времени, повреждений, salvage;
- detach debris возвращается runtime-логикой, но не является полноценной физической loot/debris системой;
- нет post-battle persistence повреждений конкретных частей;
- нет pause/settings/accessibility layer.

### 4.4. Экономика и прогрессия

Реализовано:

- `scrap` в Zustand store;
- `addReward(65)` при победе;
- сохранение локального состояния через `zustand/persist`.

Не реализовано:

- Credits;
- Y-Crystals;
- материалы;
- inventory;
- item states;
- repair;
- insurance;
- salvage choice;
- research;
- blueprints;
- crafting;
- market;
- battle pass;
- risk levels.

## 5. Сопоставление с технической документацией

`design-doc.md` требует главный цикл:

```text
Получить детали
-> собрать корабль
-> выйти в бой
-> победить / выполнить задачу
-> получить ресурсы, детали, чертежи
-> улучшить корабль
-> открыть новые каркасы и модули
```

Текущий код покрывает середину цикла:

```text
собрать корабль
-> выйти в тестовый бой
-> победить врагов
```

`design-doc2.md` усиливает формулу:

```text
Выбрал контракт
-> понял инженерную задачу
-> выбрал кабину
-> расставил панели
-> поставил элементы
-> проверил требования миссии
-> выполнил задачу
-> получил кредиты, детали, панели, коннекторы, чертежи
```

Текущий код уже частично готов к этой формуле:

- кабины есть;
- панели есть;
- элементы через legacy modules есть;
- stats/topology есть;
- battle runtime есть.

Но главный отсутствующий центр - `контракт/миссия как причина перестроить корабль`.

## 6. Короткий игровой цикл: целевое состояние

Короткий цикл, который нужно закрыть первым:

```text
Игрок видит 3-5 доступных заданий
-> выбирает одно задание
-> видит требования и риски
-> собирает или корректирует корабль
-> запускает задание
-> выполняет конкретную цель
-> видит результат
-> получает награду
-> возвращается в ангар с новым ресурсом/деталью
```

Минимальная версия под формулу пользователя:

```text
Построил корабль
-> отправился выполнять задание
-> выполнил / провалил
-> получил результат
```

Definition of Done для short loop v1:

- есть `MissionDef` как data source;
- есть экран/панель выбора задания;
- выбранная миссия сохраняется в state;
- ангар показывает mission diagnostics;
- `/battle` получает selected mission;
- бой имеет objective progress;
- result screen показывает mission-specific reward;
- reward сохраняется локально;
- после результата игрок понимает, зачем перестраивать корабль.

## 7. Длинный игровой цикл: целевое состояние

Длинный цикл:

```text
Контракты
-> инженерная диагностика
-> сборка специализированного корабля
-> миссия
-> повреждения, salvage, награды
-> repair / research / craft / market
-> новый элемент или blueprint
-> новый тип билда
-> более сложные контракты
-> social / events / season
```

Definition of Done для long loop MVP:

- минимум 5 разных миссий из `design-doc2.md`;
- каждая миссия проверяет минимум 3 параметра сборки;
- есть инвентарь physical parts;
- есть blueprints/research;
- есть материалы и Credits;
- есть repair после боя;
- есть Green/Yellow/Red risk levels;
- есть market/crafting минимум для базовых деталей;
- есть persistent progression;
- есть backend или хотя бы четкий backend contract;
- игрок за 30-60 минут открывает новую полезную деталь или билд-направление.

## 8. Главные технические риски

| Риск | Влияние | Что делать |
| --- | --- | --- |
| Нет mission abstraction | Без нее игра остается тестовой ареной. | Ввести `MissionDef`, selected mission state, objective engine. |
| Экономика полностью локальная | Нельзя доверять наградам и прогрессу. | Сначала local MVP, затем server-authoritative rewards. |
| Legacy modules и new elements смешаны | Будет расти сложность миграций. | Стабилизировать терминологию: в UI "elements", в compat оставить modules временно. |
| Нет инвентаря | Невозможно сделать потерю/ремонт/крафт. | Ввести минимальный `InventoryState`. |
| Нет mission diagnostics | Игрок не понимает, зачем менять корабль. | На первом же mission pack показывать checklist требований. |
| Enemy builds обходят панельную сборку | Враги не полностью доказывают "все корабли собраны одинаково". | Для MVP можно оставить, затем перевести врагов на valid panel builds. |
| Нет тестов игровых правил | Легко сломать сборку/урон/награды. | Добавить unit tests для build, stats, mission validation, rewards. |

## 9. Этапы разработки

Ниже порядок с большим числом малых этапов. Главный принцип: сначала закрыть короткий playable mission loop, затем расширять его в long loop.

### Блок A. Стабилизация перед mission loop

1. Зафиксировать текущую baseline-проверку.
   - `tsc --noEmit`;
   - `validate-asset-pipeline`;
   - smoke `/hangar`, `/battle`.
   - Результат: команда видит, что следующий слой не ломает playable prototype.

2. Создать `game/data/missions.ts`.
   - Добавить типы `MissionType`, `MissionRisk`, `MissionDef`.
   - Не добавлять backend.
   - Результат: миссии становятся data-driven.

3. Создать 3 первые Green missions.
   - `Training Sweep`;
   - `Drone Cleanup`;
   - `Cargo Ping`.
   - Результат: игрок выбирает не "тестовый бой", а задание.

4. Добавить mission state в Zustand.
   - `selectedMissionId`;
   - `selectMission`;
   - `lastMissionResult`.
   - Результат: `/hangar` и `/battle` говорят об одной миссии.

5. Переименовать UI-смысл `Test Battle`.
   - Кнопка должна вести не просто в тест, а в запуск выбранного задания.
   - Результат: short loop становится читаемым.

6. Добавить минимальную mission board панель.
   - Можно внутри `/hangar`, без нового маршрута.
   - Карточка: name, risk, objective, reward.
   - Результат: игрок начинает с выбора задачи.

### Блок B. Short loop v1: "построил корабль -> выполнил задание"

7. Добавить mission requirements.
   - `requiredTags`;
   - `recommendedStats`;
   - `enemyKinds`;
   - `reward`.
   - Результат: миссия начинает диктовать сборку.

8. Добавить `evaluateMissionReadiness(build, mission)`.
   - Возвращает blockers/warnings/hints.
   - Использует `calculateShipStatsV2`.
   - Результат: инженерная диагностика перед стартом.

9. Встроить mission diagnostics в ангар.
   - "Need: weapon";
   - "Recommended: shield 40";
   - "Heat risk high";
   - Результат: игрок понимает, что улучшать.

10. Заблокировать запуск только для hard blockers.
    - Нет двигателя;
    - нет реактора;
    - нет required mission tool.
    - Результат: warnings остаются выбором игрока.

11. Передать mission в `/battle`.
    - Через Zustand state.
    - На первом этапе без URL params.
    - Результат: battle больше не hardcoded только как Survival Test.

12. Добавить `MissionRuntime`.
    - `objectiveType`;
    - `progress`;
    - `target`;
    - `timeLimit`;
    - `status`.
    - Результат: бой знает, что считается выполнением.

13. Реализовать objective `destroy_all`.
    - Текущий бой уже почти это делает.
    - Результат: первый контракт работает поверх существующей арены.

14. Реализовать objective `survive_seconds`.
    - Таймер;
    - victory по времени.
    - Результат: появляется второй тип задания без новых ассетов.

15. Реализовать objective `collect_scrap`.
    - Простые collectible markers после убийства врага.
    - Результат: появляется первый не-чисто-боевой objective.

16. Добавить battle HUD objective.
    - Название миссии;
    - progress;
    - risk;
    - reward preview.
    - Результат: игрок видит задание во время боя.

17. Добавить mission result model.
   - `success`;
   - `durationSec`;
   - `kills`;
   - `damageTaken`;
   - `rewards`.
   - Результат: результат больше не просто victory/defeat.

18. Обновить result panel.
   - "Mission Complete";
   - reward breakdown;
   - damage summary;
   - next action.
   - Результат: short loop получает закрытие.

19. Сохранять награды в local progression state.
   - `credits`;
   - `scrap`;
   - `materials` минимум.
   - Результат: награды становятся полезными для следующего запуска.

20. Добавить первое действие траты.
   - Например, ремонт или покупка одного `node_plate`.
   - Результат: "получил награду -> улучшил корабль" начинает работать.

21. Acceptance short loop v1.
   - Выбрать миссию;
   - собрать корабль;
   - запустить;
   - выполнить objective;
   - получить reward;
   - вернуться в ангар;
   - увидеть изменившийся ресурс.

### Блок C. Short loop v2: миссии начинают менять билды

22. Добавить utility stats.
   - `cargoCapacity`;
   - `miningPower`;
   - `scanPower`;
   - `repairPower`;
   - `towStrength`;
   - `pointDefense`;
   - `heatStability`;
   - Результат: миссии могут проверять не только DPS/HP.

23. Добавить первые utility modules.
   - cargo container;
   - mining drill;
   - scanner;
   - heat sink;
   - point defense.
   - Результат: игрок перестраивает корабль под роль.

24. Добавить панели/роли под utility.
   - cargo floor;
   - utility mount;
   - heat sink panel.
   - Результат: панельная система начинает влиять на миссии.

25. Добавить mission `Credit Sweep`.
   - Проверяет скорость, cargo, сбор объектов.
   - Результат: первый farming contract.

26. Добавить mission `Cargo Escort`.
   - Проверяет shield/point-defense/стабильность.
   - Результат: первый defense/objective contract.

27. Добавить mission `Meteorite Drilling`.
   - Проверяет drill, heat, удержание позиции.
   - Результат: первый work contract.

28. Добавить mission `Pirate Intercept`.
   - Проверяет скорость, EMP/disable, pursuit.
   - Результат: первый chase contract.

29. Добавить mission `Drone Hive Burn`.
   - Проверяет area damage/flak/shield.
   - Результат: первый swarm contract.

30. Acceptance short loop v2.
   - Один универсальный корабль проходит хуже, чем специализированный.
   - Игрок видит это через reward и clear time.

### Блок D. Long loop local MVP

31. Ввести `InventoryState`.
   - `blueprints`;
   - `items`;
   - `materials`;
   - `currencies`.
   - Результат: награды становятся объектами.

32. Ввести item states.
   - inventory;
   - installed;
   - damaged;
   - broken;
   - lost;
   - recovered.
   - Результат: повреждения в бою могут продолжаться после боя.

33. Связать installed modules с inventory item ids.
   - Пока можно сделать local-only.
   - Результат: конкретная физическая деталь получает историю.

34. Ввести post-battle damage persistence.
   - Если часть disabled/detached, сохранить damaged/broken.
   - Результат: бой влияет на экономику.

35. Добавить repair action.
   - Credits/Scrap cost;
   - repair all;
   - repair selected.
   - Результат: игрок тратит ресурсы после миссии.

36. Добавить salvage choice.
   - 1-3 найденные награды;
   - выбрать одну или несколько по лимиту.
   - Результат: post-battle становится решением.

37. Добавить basic market.
   - Купить common modules;
   - купить панели;
   - продать broken parts.
   - Результат: loop "миссия -> деньги -> деталь" закрыт.

38. Добавить research progress.
   - Blueprint shards;
   - progress bar;
   - unlock craftable item.
   - Результат: появляется долгосрочная цель.

39. Добавить crafting.
   - Blueprint + materials -> physical copy.
   - Результат: игрок создает недостающую деталь.

40. Добавить unlock progression.
   - Новые mission tiers;
   - новые utility modules;
   - новые панели.
   - Результат: long loop получает рост.

41. Добавить Green/Yellow/Red contracts.
   - Green: безопасно;
   - Yellow: риск деталей;
   - Red: высокий риск и уникальный salvage.
   - Результат: игрок управляет риском.

42. Добавить insurance.
   - Только для Yellow/Red.
   - Результат: риск становится осознанной экономической ставкой.

43. Acceptance long loop local.
   - За 30-60 минут игрок:
     - проходит несколько миссий;
     - чинит корабль;
     - исследует blueprint;
     - крафтит новую деталь;
     - собирает новый билд;
     - открывает более сложную миссию.

### Блок E. Баланс и контент

44. Сбалансировать 5 MVP missions.
   - Reward per minute;
   - repair cost;
   - failure compensation;
   - material drop rate.

45. Сбалансировать стартовые билды.
   - Starter Scout;
   - Interceptor;
   - Gunship;
   - Assault Frame.

46. Перевести enemy builds на валидную panel/cabin модель.
   - Чтобы враги реально были собраны по тем же правилам.

47. Добавить enemy budget.
   - threat;
   - spawn groups;
   - reward multiplier.

48. Добавить mission modifiers.
   - solar storm;
   - minefield;
   - low visibility;
   - unstable reactor debris.

49. Добавить telemetry counters локально.
   - mission success rate;
   - average damage;
   - reward earned;
   - common blockers.

50. Добавить balance debug screen.
   - Таблица миссий;
   - recommended stats;
   - rewards;
   - clear rates.

### Блок F. Тесты и техническое укрепление

51. Unit tests для `canInstallPanel`.
   - connector match/mismatch;
   - active cells;
   - cabin overlap.

52. Unit tests для `canInstallModule`.
   - no panel support;
   - role mismatch;
   - reactor network requirement.

53. Unit tests для `calculateShipStatsV2`.
   - mass;
   - energy;
   - heat;
   - engine vectors.

54. Unit tests для `evaluateMissionReadiness`.
   - blockers;
   - warnings;
   - hints.

55. Unit tests для reward calculation.
   - success;
   - failure;
   - risk multiplier;
   - caps.

56. Unit tests для inventory transitions.
   - installed -> damaged;
   - broken -> repaired;
   - blueprint -> crafted.

57. Расширить smoke.
   - `/`;
   - `/hangar`;
   - mission select;
   - `/battle`;
   - result.

58. Добавить Playwright e2e.
   - выбрать миссию;
   - поставить модуль;
   - запустить бой;
   - увидеть objective HUD.

59. Добавить asset validation для новых mission assets.
   - mission icons;
   - loot sprites;
   - utility modules.

60. Добавить performance smoke.
   - canvas nonblank;
   - no console errors;
   - basic FPS budget.

### Блок G. Backend и Telegram

61. Описать backend contract.
   - user;
   - ship builds;
   - inventory;
   - missions;
   - rewards;
   - battle result submission.

62. Ввести server-authoritative profile.
   - Credits/materials/research только с сервера.

63. Ввести save/load builds API.
   - build slots;
   - selected build;
   - validation server-side.

64. Ввести mission start API.
   - server выдает mission instance.
   - фиксирует risk/reward seed.

65. Ввести battle result API.
   - клиент отправляет summary;
   - server проверяет лимиты;
   - начисляет награды.

66. Добавить Telegram Mini App boot.
   - initData validation;
   - user binding;
   - viewport/mobile constraints.

67. Добавить deep link `startapp`.
   - friend invite;
   - basic share card.

68. Добавить viral v0.1.
   - invite;
   - starter reward both sides;
   - build card sharing.

69. Добавить viral v0.2.
   - SOS Beacon;
   - Repair Help;
   - Shared Salvage Wreck.

70. Acceptance backend/Telegram.
   - Один пользователь проходит mission loop на серверном профиле.
   - Награды не зависят от localStorage.
   - Telegram user может открыть игру по invite.

## 10. Рекомендуемый порядок ближайших патчей

Самый короткий путь к настоящей игре:

1. `game/data/missions.ts` + 3 Green missions.
2. Zustand `selectedMissionId`.
3. Mission board в `/hangar`.
4. Mission diagnostics через `calculateShipStatsV2`.
5. `/battle` принимает selected mission.
6. Objective HUD + `destroy_all`/`survive_seconds`.
7. Mission result + local rewards.
8. Minimal resources UI.
9. Первый spend action: repair или buy common part.
10. Расширение до 5 MVP missions.

Не стоит начинать с battle pass, Telegram viral или real-time PvP. Они усилят игру только после того, как короткий и длинный loop уже работают.

## 11. Критерии готовности следующей версии

Версия, которую можно считать "первым настоящим game loop build":

- игрок выбирает задание, а не просто Test Battle;
- mission requirements видны до запуска;
- ангар помогает понять слабые места сборки;
- бой показывает objective progress;
- победа и поражение дают разные результаты;
- награда влияет на следующий заход;
- минимум одна трата ресурса доступна после миссии;
- 3 миссии проходят smoke/e2e;
- TypeScript и asset validation зеленые.

Версия, которую можно считать "local MVP long loop":

- 5 разных миссий;
- 5-7 utility/combat roles;
- inventory;
- repair;
- market;
- research;
- crafting;
- risk levels;
- post-battle damage persistence;
- 30-60 минут прогрессии без backend.

Версия, которую можно считать "production MVP candidate":

- backend profile;
- server-authoritative rewards;
- server-side build validation;
- Telegram initData;
- telemetry;
- anti-abuse limits;
- stable mobile performance;
- regression tests for mission/reward/inventory rules.

## 12. Итог

Текущий проект уже доказал самую дорогую часть: визуально-интерактивную связку "собрал корабль -> он реально летит и дерется". Следующий слой должен быть не новым визуалом и не монетизацией, а миссионной структурой.

Первый приоритет:

```text
MissionDef
-> Mission Board
-> Mission Readiness
-> Battle Objective
-> Mission Result
-> Persistent Reward
```

После этого Space Y перестанет быть боевой песочницей и станет игрой с понятным коротким циклом. Длинный цикл нужно строить поверх него через inventory, repair, research, crafting и risk-based contracts.
