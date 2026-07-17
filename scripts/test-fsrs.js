const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console, Date, Math, JSON, Error, Number, String, Object, Array, Promise };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/vendor/ts-fsrs.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('src/review/fsrs-adapter.js', 'utf8'), context);

const adapter = context.knowledgeFSRS;
const settings = { desiredRetention: 0.9 };
const newCard = { dueAt: new Date().toISOString(), reviews: 0, interval: 1 };
const migrated = adapter.migrate(newCard);

assert.equal(migrated.state, 'New');
assert.equal(migrated.reps, 0);
assert.ok(migrated.due);

for (const rating of ['Again', 'Hard', 'Good', 'Easy']) {
  const result = adapter.next(newCard, rating, settings);
  assert.equal(result.log.rating, rating);
  assert.ok(result.fsrs.due);
  assert.ok(result.fsrs.reps >= 1);
}

const preview = adapter.preview(newCard, settings);
assert.equal(preview.length, 4);
assert.deepEqual(preview.map((item) => item.label), ['Again', 'Hard', 'Good', 'Easy']);
console.log('FSRS adapter checks passed');
