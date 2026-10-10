import './_group.css';
import { LudoBoard } from './_shared/OriginalBoard';

export default function Current() {
  return <main className="baseline-board"><h1>Mosquito Ludo — Current board</h1><p>Design reference only. No account, match or funds are involved.</p><LudoBoard room={{ myColor:'red', board:{ redTokens:[-1,-1,-1,-1],greenTokens:[-1,-1,-1,-1] } }} legalTokens={new Set()} selecting={false} onMove={() => {}} /></main>;
}
