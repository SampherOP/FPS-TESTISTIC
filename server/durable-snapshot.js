let writer = null;
export function setDurableSnapshotWriter(fn){ writer = typeof fn === 'function' ? fn : null; }
export async function persistDurableSnapshot(name,value){ if(writer) await writer(name,value); }
