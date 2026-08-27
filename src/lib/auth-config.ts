const _envRoundsRaw = process.env.PASSWORD_BCRYPT_ROUNDS?.trim()
const _parsedRounds = _envRoundsRaw ? Number(_envRoundsRaw) : NaN
export const MIN_BCRYPT_ROUNDS = 14
export const MAX_BCRYPT_ROUNDS = 17
export const PASSWORD_BCRYPT_ROUNDS: number =
  Number.isFinite(_parsedRounds) && _parsedRounds >= MIN_BCRYPT_ROUNDS && _parsedRounds <= MAX_BCRYPT_ROUNDS
    ? Math.floor(_parsedRounds)
    : MIN_BCRYPT_ROUNDS
export const PASSWORD_REHASH_ON_LOGIN = true
Object.freeze({ PASSWORD_BCRYPT_ROUNDS, MIN_BCRYPT_ROUNDS, MAX_BCRYPT_ROUNDS, PASSWORD_REHASH_ON_LOGIN })
