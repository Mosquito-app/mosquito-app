import { useState } from 'react';
import { ReferenceView } from './_shared/ref/ReferenceView';
import type { RoomView } from './_shared/ref/ReferenceView';

// Preview-only stubs. Real presentation renderer + styles are copied from the Mosquito match page.
const room: RoomView = {
  id: 'a1b2c3d4-0000', status: 'active', stakeNaira: 1000, potNaira: 2000, prizeNaira: 1800, commissionNaira: 200, myColor: 'red',
  scores: { red: { tokensHome: 1, totalProgress: 94 }, green: { tokensHome: 0, totalProgress: 61 } },
  board: { redTokens: [-1, 3, 22, 57], greenTokens: [8, 30, -1, -1], dice: [6, 4], remainingDice: [0, 1], hasRolled: true, consecutiveDoubles: 0, isOvertime: false },
};

export default function ReferenceMatch() {
  const [sel, setSel] = useState<'d0' | 'd1' | 'both' | null>('both');
  return <ReferenceView room={room} meName="amaral" oppName="Tunde" isMyTurn isActive isWaiting={false} isDone={false}
    matchSeconds={479} turnSeconds={21} walletText={'\u20A61,250'} walletState="ok" onWallet={() => {}} onRetryWallet={() => {}} onExit={() => {}}
    previewOnly conn="preview" connLabel="Preview" legalTokens={new Set([1, 2])} onMove={() => {}} selecting
    dice={room.board.dice} rolling={false} sel={sel} canPick={{ d0: true, d1: true, both: true }} onPick={setSel} onRoll={() => {}} rollDisabled rollReady={false}
    turnText="Pick a die in the centre, then tap a glowing token." notice="" noticeBad={false} captureText="" actionError="" resultText="" />;
}
