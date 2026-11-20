// 확인 필요: 회의록이 확신하지 못한 부분을 하나씩 고치거나(추정 적용·직접 입력·채팅) 그대로 두고, 마치면 회의록에 반영한다.
// Electron 없이 돈다. 본체(CommonJS)는 src/minutes.js가 require('../lib/review/index.mjs')로 불러 쓴다.
export { parseClock, spliceLines, changedLines, stampOf } from './lines.mjs';
export { readText, readJsonFile, readReview, writeReview, setReviewStatus, markReviewItems, type Item, type Review, type Redo, type Undo } from './store.mjs';
export { applyReview, revertReview, restoreRedoRange, type Fix, type Skipped } from './apply.mjs';
export { configure, makeReview, addCheckItems, addReview, chatReview, finalizeReview, REDO_MAX_SEC, type Proposal } from './assist.mjs';
