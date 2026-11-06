# Lab 6: TypeScript для протоколу, симуляції та обох боків мережі

## 1. Рішення щодо фронтенд-фреймворку (Framework Decision)

Для лобі та HUD було прийнято рішення залишити **Vanilla TypeScript + Canvas API + типізовану шину подій `Bus<GameEvents>`** без додавання React, Svelte або Vue:
- **Нульовий оверхед бандлу:** клієнт збирається у чистий Vite-бандл розміром лише ~115 КБ (35 КБ gzip), тоді як підключення React додало б додаткові десятки кілобайт рантайму, який не потрібен для простого вибору кімнати та відображення кількох полів HUD.
- **Простота життєвого циклу:** оновлення HUD та графіка мережі (`NetStats`) відбуваються синхронно з ігровим циклом `requestAnimationFrame` (60 FPS) безпосередньо через 2D Context Canvas. Декларативний Virtual DOM або реактивність UI-фреймворків лише створювали б додаткові алокації об'єктів та навантаження на Garbage Collector у кожному кадрі.
- **Повна типізація без реактивного клею:** написаний клас `Bus<GameEvents>` та строга типізація `Connection` надали 100% строгий контракт подій без потреби у зовнішніх стейт-менеджерах.

---

## 2. Що знайшов TypeScript (What TypeScript Found)

Під час міграції кодової бази під найсуворіші правила `strict: true` та `noUncheckedIndexedAccess: true` TypeScript виявив низку потенційних помилок та граничних випадків:

1. **Небезпечний доступ до елементів масиву (`noUncheckedIndexedAccess`):**
   У `Interpolator.sample` вирази `this.snaps[i - 1]` та `this.snaps[i]` раніше вважалися гарантовано існуючими об'єктами. TypeScript вказав, що вони мають тип `Snapshot | undefined`. Якби масив знімків містив лише один елемент або виявився порожнім, це призвело б до рантайм-помилки `TypeError: Cannot read properties of undefined (reading 'tick')`. Додано явні перевірки `if (!a || !b)`.

2. **Підміна та плутанина ідентифікаторів/послідовностей (`Seq` vs `number`):**
   У `server/ws.ts` вхідне необроблене повідомлення `msg.seq` передавалося напряму в функції, що очікували порядковий номер вводу. TypeScript заблокував передачу сирого `number` туди, де очікувався branded-тип `Seq`, що змусило прогнати сирі дані через `sanitizeInput` / `asSeq` перед збереженням у стан гравця.

3. **`Map.get` повертає `undefined`:**
   У `NetGame.ts` звернення `this.players.get(s.id)` та `this.sentAt.get(snap.ack)` не враховували, що гравця або пакету може не бути в мапі (наприклад, гравець щойно вийшов, або пакет ще не надсилався). TypeScript зобов'язав явно перевіряти наявність значення перед його використанням у математичних розрахунках часу пілінгу або відображенні нікнейму.

4. **Відсутність валідації тіла запитів:**
   У `server/index.ts` при парсингу тіла POST `/api/rooms` відсутність поля `name` або його некоректний тип раніше міг спричинити створення кімнати з назвою `undefined`. Впровадження схеми `RoomBodySchema` через Zod унеможливило створення некоректних кімнат на рівні API.

5. **Вичерпність обробки типів повідомлень (`never` default):**
   У диспетчерах повідомлень сервера та клієнта додано конструкцію `default: const _exhaustive: never = msg; return _exhaustive;`. Це гарантує на етапі компіляції, що при додаванні нового типу повідомлення (наприклад, `chat`) компілятор видасть помилку, доки розробник не напише для нього обробник у `switch`.

---

## 3. Три цікаві типи (Three Explained Types)

### 1. Номінальні брендовані типи (`EntityId`, `Tick`, `Seq`)

```ts
export type EntityId = number & { readonly __brand: 'EntityId' };
export type Tick = number & { readonly __brand: 'Tick' };
export type Seq = number & { readonly __brand: 'Seq' };
```
*Пояснення простими словами:*
У JavaScript і звичайному TypeScript будь-яке число — це просто `number`. Через це можна випадково передати номер кадру (`tick = 120`) замість ідентифікатора корабля (`id = 120`), і JavaScript навіть не попередить про помилку.
Брендований тип додає до числа уявне поле `__brand`, якого насправді не існує в пам'яті в рантаймі (нульові витрати продуктивності), але компілятор тепер вважає `EntityId` та `Tick` абсолютно несумісними різними типами. Щоб перетворити звичайне число на безпечний ідентифікатор, викликається конструктор `asEntityId(n)`.

### 2. Дискриміноване об'єднання з перевіркою вичерпності (`discriminated union` + `never`)

```ts
export type EntitySnapshot = ShipSnapshot | BulletSnapshot | AsteroidSnapshot;

function renderEntity(entity: EntitySnapshot): void {
  switch (entity.kind) {
    case 'ship': return drawShip(entity);
    case 'bullet': return drawBullet(entity);
    case 'asteroid': return drawAsteroid(entity);
    default: {
      const _exhaustive: never = entity;
      return _exhaustive;
    }
  }
}
```
*Пояснення простими словами:*
Усі типи сутностей у знімку мають спільне строкове поле `kind` (`'ship'`, `'bullet'`, `'asteroid'`). Коли ми пишемо `switch (entity.kind)`, всередині блоку `case 'ship'` TypeScript точно знає, що це саме корабель, і дозволяє звертатися до його здоров'я `hp` чи `cooldown`.
Блок `default` з присвоєнням до типу `never` діє як компіляторний капкан: якщо завтра ми додамо новий тип сутності (наприклад, `{ kind: 'pickup' }`), компілятор негайно видасть червону помилку на рядку `const _exhaustive: never = entity`, вказавши, що ми забули додати новий `case` у `switch`.

### 3. Узагальнена строго типізована шина подій (`Bus<Events extends object>`)

```ts
export class Bus<Events extends object> {
  on<K extends keyof Events & string>(event: K, handler: (data: Events[K]) => void): () => void;
  emit<K extends keyof Events & string>(event: K, data: Events[K]): void;
}
```
*Пояснення простими словами:*
Звичайна шина подій у JavaScript (`EventTarget` або `EventEmitter`) приймає будь-яке ім'я події як рядок і довільні дані, тому легко зробити друкарську помилку на кшталт `bus.emit('plaer_hit')` замість `bus.emit('player_hit')`.
Дженерик `Bus<Events>` прив'язує назву події `K` до конкретного типу аргументу `Events[K]`. Тепер редактор автоматично підказує доступні назви подій, а якщо спробувати передати невідповідні дані (наприклад, рядок замість об'єкта зі здоров'ям), компілятор TypeScript відхилить код ще до запуску.

