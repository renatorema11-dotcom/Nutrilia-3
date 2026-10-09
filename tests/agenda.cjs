// Testa o cálculo de horários da Ali e as configurações da nutricionista (sem serviços externos).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const assert = require('node:assert/strict');

function load(file, context) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
  const code = stripTypeScriptTypes(source)
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export (?=(async )?function|const|let)/gm, '');
  vm.runInContext(code, context);
}

const context = vm.createContext({});
load('ali-settings.ts', context);
load('agenda.ts', context);
const t = (code) => vm.runInContext(code, context);

let count = 0;
const check = (name, fn) => { fn(); count++; };

const settings = t('defaultAliSettings("Dra. Carla")');
const tz = 'America/Sao_Paulo';

check('converte horário de Brasília para UTC', () => {
  assert.equal(t(`zonedToDate(2026, 10, 14, 14, 0, '${tz}').toISOString()`), '2026-10-14T17:00:00.000Z');
  assert.equal(t(`toOffsetIso(new Date('2026-10-14T17:00:00Z'), '${tz}')`), '2026-10-14T14:00:00-03:00');
});

// Segunda-feira, 12/10/2026, 09:00 em Brasília.
context.now = new Date('2026-10-12T12:00:00Z');
context.settings = settings;

check('respeita antecedência e espalha dois horários por dia', () => {
  const slots = Array.from(t('generateSlots(settings, [], now, { max: 5 })'), (s) => s.start);
  assert.deepEqual(slots, [
    '2026-10-13T08:00:00-03:00', '2026-10-13T09:00:00-03:00',
    '2026-10-14T08:00:00-03:00', '2026-10-14T09:00:00-03:00',
    '2026-10-15T08:00:00-03:00',
  ]);
});

check('pula horários ocupados com o intervalo de folga', () => {
  context.busy = [{ start: new Date('2026-10-13T11:30:00Z'), end: new Date('2026-10-13T12:30:00Z') }];
  const slots = Array.from(t('generateSlots(settings, busy, now, { date: "2026-10-13", max: 3 })'), (s) => s.start);
  assert.deepEqual(slots, ['2026-10-13T10:00:00-03:00', '2026-10-13T11:00:00-03:00', '2026-10-13T12:00:00-03:00']);
});

check('filtra por período', () => {
  const slots = Array.from(t('generateSlots(settings, [], now, { period: "tarde", max: 2 })'), (s) => s.start);
  assert.deepEqual(slots, ['2026-10-13T12:00:00-03:00', '2026-10-13T13:00:00-03:00']);
});

check('não oferece fim de semana nem fora do horário', () => {
  const slots = t('generateSlots(settings, [], now, { date: "2026-10-17", max: 5 })');
  assert.equal(slots.length, 0);
});

check('valida o horário escolhido', () => {
  assert.ok(!('error' in t('validateSlotStart(settings, "2026-10-13T10:00:00-03:00", now)')));
  assert.ok('error' in t('validateSlotStart(settings, "2026-10-13T10:30:00-03:00", now)'));
  assert.ok('error' in t('validateSlotStart(settings, "2026-10-17T10:00:00-03:00", now)'));
  assert.ok('error' in t('validateSlotStart(settings, "2026-10-12T15:00:00-03:00", now)'));
  assert.ok('error' in t('validateSlotStart(settings, "amanhã às 10h", now)'));
});

check('saneia o formulário da nutricionista', () => {
  const s = t(`sanitizeAliSettings({ startTime: '19:00', endTime: '08:00', durationMinutes: 999, workDays: [9, 1, 1, 3],
    guidelines: 'Seja {{gentil}} ' + 'x'.repeat(2000), mode: 'qualquer' })`);
  assert.equal(s.startTime, '08:00');
  assert.equal(s.endTime, '18:00');
  assert.equal(s.durationMinutes, 50);
  assert.deepEqual(Array.from(s.workDays), [1, 3]);
  assert.ok(!s.guidelines.includes('{'));
  assert.equal(s.guidelines.length, 800);
  assert.equal(s.mode, 'online');
});

check('descreve o atendimento em português', () => {
  assert.equal(t('describeWorkDays([1,2,3,4,5])'), 'segunda a sexta');
  assert.equal(t('describeWorkDays([1,3])'), 'segunda e quarta');
  assert.ok(t('describeAttendance(settings)').startsWith('segunda a sexta, das 08:00 às 18:00, consultas de 50 minutos'));
});

console.log(`${count} verificações da agenda da Ali passaram. Nenhum serviço externo foi chamado.`);
