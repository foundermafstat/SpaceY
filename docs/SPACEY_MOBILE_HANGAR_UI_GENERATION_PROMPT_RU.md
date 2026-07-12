# SpaceY — промт для генерации мобильного интерфейса ангара

Дата: 2026-07-12

## 1. Назначение документа

Этот документ описывает все пользовательские элементы страницы ангара SpaceY и содержит готовый цельный промт для генерации концептов интерфейса. Интерфейс предназначен прежде всего для Telegram Mini App и должен восприниматься как мобильная игра, а не как веб-сайт, SaaS-панель или административный dashboard.

Нужно генерировать несколько отдельных изображений состояний одного согласованного интерфейса:

1. основной экран ангара без открытых панелей;
2. Drawer со списком контрактов;
3. Drawer управления кораблём;
4. Drawer инвентаря;
5. выбранный контракт перед запуском;
6. landscape-версию основного экрана.

## 2. Целевые размеры

Основной макет:

- portrait: **390 × 844 px**, соотношение примерно 19.5:9;
- расширенный portrait: **430 × 932 px**;
- landscape: **932 × 430 px**;
- интерфейс должен также корректно сжиматься до ширины 360 px;
- учитывать верхнюю и нижнюю safe area Telegram и системные зоны iOS/Android;
- никакие игровые кнопки, заголовки и значения не должны находиться под системными кнопками Telegram, часами, Dynamic Island, вырезом камеры или home indicator.

Для генерации основного концепта использовать холст **390 × 844 px**.

## 3. Игра и сеттинг

SpaceY — серьёзная научно-фантастическая мобильная игра о сборке модульных космических кораблей и прохождении контрактов. Игрок находится внутри промышленного орбитального ангара и собирает корабль из серверных модулей на координатной сетке.

Ключевые образы:

- глубокий космос и орбитальные верфи;
- индустриальные панели, тёмный металл, технологические швы;
- холодный cyan-свет, редкие violet-акценты;
- энергетические контуры, голографические слои и тонкие линии телеметрии;
- ощущение военного терминала будущего;
- интерфейс физически встроен в ангar, но остаётся хорошо читаемым;
- сервер является источником истины: корабль, инвентарь, контракты и награды подтверждаются сервером.

Это не мультяшная casual-игра. Визуальное настроение: премиальная sci-fi стратегия, tactical space engineering, серьёзная технологичная атмосфера.

## 4. Общая композиция

В нормальном состоянии на экране постоянно находятся только три уровня:

1. компактный HUD сверху;
2. большое центральное поле корабля;
3. компактная action bar снизу.

Центральное поле — главный визуальный объект. Оно должно занимать примерно **68–76% высоты экрана**. Постоянный HUD не должен перекрывать корабль. Вторичная информация выводится только после нажатия icon-trigger в нижнем Drawer.

Запрещены постоянно раскрытые длинные панели, большие таблицы, повторяющиеся заголовки, технические UUID и длинная версия контента на основном экране.

## 5. Постоянный верхний HUD

Высота HUD ориентировочно 82–104 px с учётом safe area. Фон тёмный, полупрозрачный, с тонкой cyan-рамкой и лёгким blur.

### 5.1 Идентификация корабля

- маленький маркер с иконкой процессора или серверного узла: `SERVER SHIP`;
- название активного корабля, например `Contract Breaker`;
- под названием — выбранный контракт, например `Convoy Guard`;
- если контракт не выбран: `No contract selected`;
- название обрезается через ellipsis и никогда не переносится поверх соседних элементов.

### 5.2 Компактный кошелёк

Показывать только две основные валюты:

- Credits — энергетическая или lightning-иконка и число;
- Scrap — иконка контейнера/металла и число.

Alloy и Data Shards скрыть в подробной панели, если их значения не критичны. Не писать длинные слова `Credits` и `Scrap` в постоянном HUD — использовать понятные иконки и числа.

### 5.3 Icon-trigger кнопки

Четыре квадратные touch-кнопки не меньше 44 × 44 px:

- Contracts — иконка портфеля/миссии;
- Build — иконка редактирования/схемы;
- Inventory — иконка контейнера; может иметь числовой badge;
- Ship Info — иконка информации/щита.

У кнопок есть aria-label/tooltip в реализации, но на основном экране текстовые подписи можно не показывать. Активное и нажатое состояние подсвечивается cyan-контуром.

## 6. Центральное поле корабля

### 6.1 Фон

- промышленный орбитальный ангар;
- тёмные панели, рельсы, кабели, сервисные механизмы;
- центральная зона темнее краёв;
- слабая координатная сетка;
- локальный cyan-свет вокруг корабля;
- фон достаточно спокойный, чтобы не конкурировать с модулями.

### 6.2 Сетка сборки

- квадратные ячейки с тонкими технологическими линиями;
- пустые клетки почти прозрачные;
- координаты клеток очень маленькие и второстепенные;
- сетка допускает drag/pan и должна визуально показывать, что поле больше экрана;
- корабль автоматически расположен в центре видимой области;
- не выводить длинную версию content release поверх сетки.

### 6.3 Модули корабля

Каждый установленный модуль выглядит как компактная игровая карточка/плитка:

- Structure/Core/Hull — cyan/steel;
- Weapons — crimson/magenta;
- Engines/Thrusters — amber/orange;
- Power/Reactor/Shield — violet/blue;
- выбранный модуль — яркая cyan-рамка и мягкий glow;
- внутри: крупная иконка типа модуля;
- короткое имя или аббревиатура;
- ориентация показывается маленькой стрелкой, а не обязательным текстом `0°`;
- длинные идентификаторы `starter-blaster`, `shield_generator` не должны выходить за плитку.

Пример корабля `Contract Breaker` содержит десять модулей:

- starter core;
- small reactor;
- два hull blocks;
- starter blaster;
- autocannon;
- starter shield;
- starter engine;
- ion engine;
- maneuver thruster.

### 6.4 Компактный статус

В углу поля можно разместить небольшой знак:

- иконка щита;
- `v1` — revision;
- зелёная точка при успешной server validation;
- красный/amber индикатор только при ошибке.

Не показывать отдельные большие карточки `Authority`, `Revision`, `Validation` постоянно.

## 7. Нижняя action bar

Высота примерно 52–64 px плюс нижняя safe area.

### 7.1 Основное действие

Крупная, но компактная кнопка:

- без выбранной миссии: иконка target + `Select contract`;
- при выбранной миссии: иконка play + `Launch`;
- во время создания attempt: spinner + `Creating`;
- при активной миссии: play + `Resume`.

Цвет: яркий cyan-to-violet gradient. Touch-target не меньше 48 px.

### 7.2 Вторичное действие

- `PvP` с иконкой crosshair;
- при активной попытке — `Abandon` или `Cancel`;
- вторичная кнопка тёмная, с тонкой рамкой, заметно слабее Launch.

## 8. Системные сообщения

Server validation, saving и ошибки не занимают постоянные карточки. Использовать компактную временную toast/status strip:

- success — cyan/green;
- saving — cyan со spinner;
- warning — amber;
- error — red;
- одна строка с ellipsis;
- расположение под HUD или над action bar;
- автоматически исчезает после успешного действия.

## 9. Drawer: общие правила

Drawer открывается снизу поверх ангара после нажатия icon-trigger.

- максимальная высота 80–82% viewport в portrait;
- внутренний вертикальный scroll;
- фон почти непрозрачный, чтобы контент читался;
- затемнённый backdrop;
- swipe handle сверху;
- swipe down закрывает панель;
- явная кнопка закрытия с иконкой X;
- обязательно есть title и description;
- в landscape допускается нижний Drawer на 88–92% высоты или боковая панель;
- Drawer не должен выходить за safe area;
- открытый Drawer блокирует взаимодействие с сеткой корабля.

В верхней части Drawer находится компактная навигация из трёх вкладок:

- Contracts;
- Build;
- Inventory.

На узких экранах вкладки могут показывать только иконки.

## 10. Drawer Contracts

### Заголовок

- `Contracts`;
- описание выбранной цели или `Choose a server-authoritative mission`.

### Карточка контракта

Каждая миссия содержит:

- risk badge: GREEN/YELLOW/RED;
- короткое название;
- иконку типа: destroy, escort, salvage или PvP;
- одну строку objective;
- длительность;
- компактный preview награды: Credits и Scrap;
- маленький индикатор server validation;
- кнопку/область `View briefing`;
- выбранная карточка имеет cyan-рамку и checkmark.

Доступные примеры:

- Starter Scout — уничтожить противников;
- Convoy Guard — защищать конвой 60 секунд;
- Salvage Sweep — собрать scrap;
- Ranked Duel — уничтожить корабль соперника.

Не показывать четыре громоздкие карточки на основном экране. Все контракты существуют только внутри Drawer.

## 11. Drawer Build

### Общая информация

- название корабля;
- revision;
- число установленных модулей;
- небольшой server-validated indicator;
- content version доступна в details, но не доминирует.

### Переименование

- компактное поле имени;
- icon-button Save;
- состояние saving/disabled.

### Инспектор выбранного модуля

- иконка и короткое название;
- durability;
- координата;
- orientation;
- тип/категория;
- компактный directional pad для перемещения;
- rotate icon;
- remove/return-to-inventory action;
- опасное действие визуально отделено.

Если модуль не выбран, показывать короткую подсказку: `Tap a ship module to edit`.

## 12. Drawer Inventory

### Заголовок

- `Inventory`;
- количество available и total;
- фильтры и сортировка в будущем могут быть icon-buttons.

### Элемент inventory

- крупная иконка типа;
- короткое имя;
- rarity badge;
- durability bar/percentage;
- state: available, installed, damaged, destroyed;
- installed элементы визуально disabled;
- damaged элементы имеют amber/red damage contour;
- available элемент можно выбрать для установки;
- после выбора Drawer закрывается или остаётся в компактном режиме, а пустые ячейки сетки подсвечиваются зелёным.

Использовать компактную двухколоночную сетку на 390–430 px и одну колонку на 360 px. Тексты обязательно обрезаются, карточки не выходят за границы.

## 13. Landscape-компоновка

Для 932 × 430 px:

- HUD располагается одной компактной горизонтальной строкой сверху;
- поле корабля занимает основную левую/центральную область;
- action bar располагается вертикально справа;
- Drawer может открываться снизу либо как правая боковая панель;
- системные кнопки Telegram и safe area остаются свободными;
- не использовать три постоянно раскрытые колонки;
- корабль остаётся главным визуальным объектом.

## 14. Визуальный язык

### Палитра

- background: `#030610` / `#050914`;
- panel: `rgba(9, 17, 34, 0.92)`;
- cyan primary: `#49D7FF`;
- cyan highlight: `#7DF8FF`;
- violet accent: `#9B5CFF`;
- green success: `#53E7A4`;
- amber engine/warning: `#FFC857`;
- red danger/weapon: `#FF596A`;
- main text: `#EDF7FF`;
- muted text: `#8FA4B8`.

### Материалы

- тёмное стекло;
- anodized metal;
- holographic cyan edge lighting;
- тонкие технические линии;
- restrained blur;
- минимальный glow только у активных элементов;
- без чрезмерного neon bloom.

### Типографика

- узкий condensed sci-fi display font для заголовков;
- хорошо читаемый sans-serif для значений;
- numeric tabular figures для валют и телеметрии;
- не использовать сверхтонкий шрифт для важных кнопок;
- минимальный текст не меньше визуального эквивалента 11–12 px;
- кнопки и значения должны читаться на реальном телефоне.

### Иконки

- единый outline-набор;
- толщина линий одинаковая;
- иконки: contract, target, play, inventory crate, edit, shield, reactor, engine, weapon, close, rotate, arrows, credits, scrap;
- не смешивать emoji, filled icons и outline icons;
- не заменять иконками уникальные значения, которые пользователь должен точно прочитать.

## 15. Интерактивные состояния

Для макета желательно показать:

- default;
- pressed;
- selected;
- disabled;
- loading;
- server validated;
- warning;
- error;
- damaged inventory item;
- Drawer opening state.

Анимация сдержанная:

- Drawer — smooth spring/swipe;
- success — короткий cyan pulse;
- selected module — мягкое свечение;
- launch — один выраженный transition;
- учитывать `prefers-reduced-motion`.

## 16. Запрещённые решения

- интерфейс SaaS/dashboard;
- длинная строка `REV1 PARTS10 ITEMS1 CONTENT2026...`;
- длинная версия контента поверх корабля;
- четыре постоянно видимые карточки валют;
- большие постоянные панели Authority/Revision/Validation;
- постоянно раскрытые Contracts, Build и Inventory;
- горизонтальный scroll всей страницы;
- элементы под системной панелью Telegram;
- текст, выходящий за карточки;
- слишком маленькие touch-target;
- одинаковый визуальный вес у Launch и вторичных действий;
- Drawer без заголовка или кнопки закрытия;
- центральные модальные окна, закрывающие корабль без необходимости;
- слишком яркий фон, ухудшающий читаемость модулей.

## 17. Готовый цельный промт

Скопируйте следующий блок целиком в генератор интерфейсов:

```text
Design a production-quality portrait mobile game interface for SpaceY, a serious sci-fi modular spaceship construction and contract game running as a Telegram Mini App.

Canvas: 390 x 844 px, portrait mobile screen, approximately 19.5:9. Also prepare the system so it can adapt to 430 x 932 px portrait and 932 x 430 px landscape. Respect iOS and Android safe areas, Telegram top controls, camera cutouts, Dynamic Island and bottom home indicator. No interactive element may overlap system UI.

SETTING AND MOOD
The player is inside a dark industrial orbital shipyard. The background contains restrained metal panels, service rails, cables, maintenance machinery and subtle cyan work lights. The central area is darker and contains a technical construction grid. The visual direction is premium tactical science fiction: dark glass, anodized metal, holographic cyan edges, restrained violet accents, military engineering terminal, serious and sophisticated rather than cartoonish or casual. The interface must feel native to a space game, not like a SaaS dashboard or website.

CORE COMPOSITION
Keep the spaceship construction field as the dominant visual area, occupying roughly 68–76 percent of the screen height. Use only three persistent layers: a compact top HUD, a large central ship viewport, and a compact bottom action bar. Move secondary content into a swipeable bottom Drawer. Keep the center and lower-middle playfield visually clear. Never display all panels at once.

TOP HUD
Create a compact dark translucent HUD with a thin cyan technical border. Show a tiny processor/server icon with the label SERVER SHIP, the active ship name Contract Breaker, and one short secondary line showing the selected contract Convoy Guard or No contract selected. All text must truncate safely.

On the right show only two compact wallet chips: a lightning/credit icon with the Credits amount and a metal crate/scrap icon with the Scrap amount. Do not permanently show Alloy or Data Shards.

Below or beside the identity area place four 44 x 44 px icon-only touch controls: Contracts with a briefcase/mission icon, Build with an edit/schematic icon, Inventory with a crate icon and a small numeric badge, and Ship Info with an info/shield icon. Use accessible, recognizable outline icons with consistent stroke weight.

SHIP VIEWPORT
The central viewport shows a modular spaceship centered on a subtle coordinate grid. Empty cells are very dark and low contrast. Installed module tiles use category colors: cyan steel for structure/core/hull, crimson for weapons, amber for engines/thrusters, violet-blue for reactor/power/shield. Each tile contains a large category icon, a short module name or abbreviation, and a small orientation arrow. Never allow long identifiers to overflow.

Build the visible Contract Breaker ship from ten connected modules: starter core, small reactor, two hull blocks, starter blaster, autocannon, starter shield, starter engine, ion engine and maneuver thruster. Highlight one selected module with a sharp cyan border and subtle glow. Add a tiny corner status with a shield icon, revision v1 and a green server-validated dot. Do not show a long content version watermark.

BOTTOM ACTION BAR
Create one dominant cyan-to-violet gradient action button. If no mission is selected it shows a target icon and Select contract. If a mission is selected it shows a play icon and Launch. Add one smaller dark secondary button for PvP with a crosshair icon. Touch targets must be at least 48 px high. Launch must have clearly stronger visual hierarchy than PvP.

SERVER FEEDBACK
Saving, validation and error feedback appears only as a temporary compact one-line status strip, not as three permanent information cards. Use cyan/green for success, amber for warning and red for error.

DRAWER SYSTEM
Design a shadcn/Base UI style bottom Drawer opened by the icon triggers. It uses a dark nearly opaque sci-fi panel, dimmed backdrop, swipe handle, clear close X button, mandatory title and short description, internal vertical scrolling and a maximum height of about 80–82 percent of the viewport. It respects safe areas and blocks ship-grid interaction while open. Include three compact tabs: Contracts, Build and Inventory. On very narrow screens the tabs may show icons only.

CONTRACTS DRAWER STATE
Show compact mission cards for Starter Scout, Convoy Guard, Salvage Sweep and Ranked Duel. Each card includes a risk badge, mission-type icon, short title, one-line objective, duration, compact Credits/Scrap reward preview, server-validation indicator and View briefing action. Selected mission uses a cyan border and checkmark. Do not place mission cards on the default ship screen.

BUILD DRAWER STATE
Show ship name, revision, installed module count and a small server-validated indicator. Include a compact rename field with icon save action. When a module is selected show its icon, short name, durability, coordinate, orientation, a directional movement pad, rotate action and a visually separated return-to-inventory action. When no module is selected show the short instruction Tap a ship module to edit.

INVENTORY DRAWER STATE
Show available and total item counts. Use a compact two-column item grid. Each inventory item has a large category icon, truncated short name, rarity badge, durability indicator and state: available, installed, damaged or destroyed. Installed items are disabled. Damaged items use amber or red damage treatment. Available items can be selected for installation. On 360 px screens switch to one column.

LANDSCAPE ADAPTATION
For 932 x 430 px landscape, use one compact horizontal HUD at the top, a large ship viewport in the left/center area and a narrow vertical action bar on the right. Open secondary content as a bottom Drawer or right-side Drawer. Never use three permanently expanded columns.

COLOR SYSTEM
Background #030610 and #050914. Panels rgba(9,17,34,0.92). Primary cyan #49D7FF and highlight #7DF8FF. Violet accent #9B5CFF. Success #53E7A4. Engine/warning amber #FFC857. Danger/weapon red #FF596A. Main text #EDF7FF. Muted text #8FA4B8.

TYPOGRAPHY AND LEGIBILITY
Use a narrow condensed sci-fi display font for headings and a highly readable sans-serif for values and controls. Use tabular numeric figures for currency. Important labels and buttons must remain readable on a real phone. Avoid ultra-thin typography. All long text must truncate or wrap within its container.

INTERACTION STATES
Represent default, pressed, selected, disabled, loading, server validated, warning, error and damaged states. Motion is restrained: smooth Drawer swipe, short cyan success pulse, subtle selected-module glow and one strong launch transition. Support reduced motion.

AVOID
No SaaS dashboard layout, no permanent REV/PARTS/ITEMS/CONTENT text row, no long content version over the ship, no four permanent currency boxes, no permanent Authority/Revision/Validation cards, no always-open mission/build/inventory panels, no page-level horizontal scrolling, no content under Telegram system controls, no tiny touch targets, no overflowing labels, no excessive neon bloom, no emoji icon mixing, and no modal that unnecessarily covers the ship.

Output polished high-fidelity mobile game UI mockups with consistent components across all Drawer states. The default screen must immediately read as a playable spaceship hangar with the ship as the hero, not as a data-heavy web application.
```

## 18. Рекомендуемый набор изображений

Для дальнейшей разработки сгенерировать минимум шесть изображений с одинаковой дизайн-системой:

1. `hangar-default-390x844.png`;
2. `hangar-contract-selected-390x844.png`;
3. `hangar-contracts-drawer-390x844.png`;
4. `hangar-build-drawer-390x844.png`;
5. `hangar-inventory-drawer-390x844.png`;
6. `hangar-landscape-932x430.png`.

Все изображения должны показывать один и тот же корабль, одинаковую палитру, одинаковые размеры компонентов и одинаковую систему иконок.
