import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hmac, timingSafeEqual, createToken, verifyToken, isValidSpaceId,
} from '../src/auth.js';

const SECRET = 'test-secret-value';

test('createToken/verifyToken: 正しいトークンはspaceIdを返す', async () => {
  const token = await createToken(SECRET, 'abc123def456ghi789jk');
  assert.equal(await verifyToken(SECRET, token), 'abc123def456ghi789jk');
});

test('verifyToken: 改ざんされたトークンはnull', async () => {
  const token = await createToken(SECRET, 'abc123def456ghi789jk');
  const [spaceId, exp] = token.split('.');
  const tampered = `${spaceId}.${exp}.0000000000000000000000000000000000000000000000000000000000000000`;
  assert.equal(await verifyToken(SECRET, tampered), null);
});

test('verifyToken: spaceIdが書き換えられたトークンはnull（署名不一致）', async () => {
  const token = await createToken(SECRET, 'abc123def456ghi789jk');
  const [, exp, sig] = token.split('.');
  const tampered = `attacker-space-id-000.${exp}.${sig}`;
  assert.equal(await verifyToken(SECRET, tampered), null);
});

test('verifyToken: 期限切れなら失敗', async () => {
  const token = await createToken(SECRET, 'abc123def456ghi789jk', -1);
  assert.equal(await verifyToken(SECRET, token), null);
});

test('verifyToken: 不正な形式のトークンは失敗', async () => {
  assert.equal(await verifyToken(SECRET, 'not-a-valid-token'), null);
  assert.equal(await verifyToken(SECRET, ''), null);
  assert.equal(await verifyToken(SECRET, null), null);
});

test('verifyToken: 別のシークレットで作られたトークンは失敗', async () => {
  const token = await createToken(SECRET, 'abc123def456ghi789jk');
  assert.equal(await verifyToken('a-different-secret', token), null);
});

test('timingSafeEqual: 一致/不一致/長さ違い', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual(null, null), true);
});

test('hmac: 同じ入力は同じ出力、違う秘密鍵は違う出力', async () => {
  const a = await hmac(SECRET, 'hello');
  const b = await hmac(SECRET, 'hello');
  const c = await hmac('other-secret', 'hello');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('isValidSpaceId: 22文字の小文字英数字はOK、それ以外はNG', () => {
  assert.equal(isValidSpaceId('abcdefghij0123456789ab'), true);
  assert.equal(isValidSpaceId('short'), false);
  assert.equal(isValidSpaceId('Has-Upper-Or-Dash-1234'), false);
  assert.equal(isValidSpaceId(''), false);
  assert.equal(isValidSpaceId(undefined), false);
});
