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
Create several distinct high-fidelity visual concepts for the mobile game interface of SpaceY. Do not follow a predetermined layout. Explore original compositions and interaction patterns, and let each concept propose its own hierarchy, positioning, navigation and way of revealing secondary information.

FORMAT
Portrait mobile game screen, 390 x 844 px, approximately 19.5:9. The interface runs inside a Telegram Mini App and must visually respect mobile safe areas. The result should clearly look like a real mobile game rather than a desktop website.

GAME SETTING
SpaceY is a serious science-fiction game about constructing modular spacecraft, managing ship parts and completing contracts. The player is standing inside a large industrial orbital shipyard surrounded by dark metal structures, service rails, mechanical equipment, cables, docking systems, repair machinery and distant space. The active ship is assembled from separate functional modules on a technical construction field.

The atmosphere should feel like premium tactical science fiction: orbital engineering, military spacecraft systems, industrial technology, precise server-controlled machinery and dangerous deep-space missions. The mood is serious, immersive, intelligent and technologically advanced, not cartoonish or casual.

AVAILABLE INTERFACE ELEMENTS
The interface may use and arrange the following elements in any effective way:

- active modular spaceship as the main game object;
- technical ship construction grid or assembly field;
- ship name, for example Contract Breaker;
- selected contract or mission status;
- player currencies: Credits, Scrap, Alloy and Data Shards;
- Contracts control and mission list;
- Build or Edit Ship control;
- Inventory control and item list;
- Ship Info or technical status control;
- primary Launch Contract action;
- secondary Ranked PvP action;
- server validation, saving, loading, warning and error states;
- ship revision and installed module count;
- module details, durability, category, position and orientation;
- controls for moving, rotating, installing and removing modules;
- mission cards with risk, objective, duration and reward preview;
- inventory cards with rarity, durability and state;
- temporary panels, drawers, sheets, floating controls, contextual menus, radial menus, tabs, overlays or any other mobile-game navigation pattern proposed by the model.

The modular ship may contain a core, reactor, hull blocks, blaster, autocannon, shield, main engine, ion engine and maneuver thruster. Different module categories should be visually distinguishable.

BASE COLOR PALETTE

- near-black deep-space background: #030610 and #050914;
- dark blue-black interface surfaces: approximately #091122 with translucent variations;
- primary cyan: #49D7FF;
- bright cyan highlight: #7DF8FF;
- restrained violet accent: #9B5CFF;
- success and valid state: #53E7A4;
- engine, energy or warning amber: #FFC857;
- weapon, damage or danger red: #FF596A;
- primary text: #EDF7FF;
- secondary text: #8FA4B8.

These colors are a foundation, not a rigid rule. Each concept may vary their proportions, brightness, materials and lighting while remaining recognizably part of SpaceY.

VISUAL STYLE

- dark industrial orbital sci-fi;
- premium mobile game UI;
- dark glass, anodized metal and layered technical surfaces;
- holographic cyan edges and subtle energy illumination;
- thin engineering lines, restrained grid patterns and precise iconography;
- controlled glow rather than excessive neon bloom;
- strong contrast and readable information on a real phone;
- condensed futuristic typography for major labels combined with a highly readable font for values;
- coherent outline or technical-symbol icon system;
- tactile touch controls suitable for thumbs;
- visual depth created by transparency, lighting, material layers and the orbital hangar behind the interface.

CREATIVE FREEDOM
Do not assume a top HUD, bottom navigation, drawer placement, fixed card grid or any existing SpaceY screen composition. Invent the final interface structure. The spacecraft should remain visually important, but decide independently how much space it receives and how the user accesses contracts, inventory and build controls.

Generate 4 to 6 meaningfully different design directions, not minor color variations. Explore different concepts such as an integrated cockpit terminal, holographic orbital workbench, tactical engineering console, minimal cinematic hangar HUD, radial ship-control interface, or layered industrial command system. Keep the same game setting, available elements and base palette across all variants, while changing composition, hierarchy and navigation substantially.

The purpose is concept exploration. Prioritize original, production-quality mobile game interface ideas and give the design model freedom to surprise the viewer.
```

## 18. Рекомендуемый результат генерации

Запросить **4–6 разных концепций** основного мобильного экрана ангара в размере 390 × 844 px. Каждый вариант должен предлагать самостоятельную композицию и механику навигации.

Это должны быть не цветовые вариации одного макета, а существенно разные дизайн-направления. После выбора лучшей концепции можно отдельно генерировать её детальные состояния — Contracts, Build, Inventory и landscape.
