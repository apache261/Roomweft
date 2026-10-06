// Camera effects use actual distance travelled, independently of collision and
// saved standing positions. Pushing against a wall does not produce footsteps.
export class WalkingEffects {
  private phase=0;
  private weight=0;
  get active(){return this.weight > 0;}
  reset(){this.phase=0;this.weight=0;}
  step(distance:number,seconds:number,enabled:boolean){
    if(!enabled||!Number.isFinite(seconds)||seconds<0||seconds>.25){this.reset();return 0;}
    const moving=Number.isFinite(distance)&&distance>1e-5;
    if(moving)this.phase=(this.phase+distance*Math.PI*2/.7)%(Math.PI*2);
    this.weight+=(Number(moving)-this.weight)*(1-Math.exp(-12*Math.min(seconds,.1)));
    if(this.weight<1e-4){this.weight=0;return 0;}
    return Math.sin(this.phase)*.018*this.weight;
  }
}

export function readWalkingPreference(name:string):boolean|undefined {
  try {const value=localStorage.getItem('tour-walking-'+name);return value==='true'?true:value==='false'?false:undefined;}catch{return undefined;}
}
export function saveWalkingPreference(name:string,value:boolean){
  try {localStorage.setItem('tour-walking-'+name,String(value));}catch{/* Browser storage is optional. */}
}
