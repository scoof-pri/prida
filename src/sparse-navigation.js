// Bounded A* working memory; never allocate predecessor/cost heaps for the entire 4x world.
export function sparsePath(nav,a,b,budget=30000){
  const start=nav.node(a),end=nav.node(b);if(start<0||end<0||start===end)return [];
  budget=Math.min(30000,Math.max(1,budget|0));const prev=new Map([[start,start]]),cost=new Map([[start,0]]),closed=new Set(),heap=[];
  const h=k=>Math.abs(k%nav.w-end%nav.w)+Math.abs(Math.floor(k/nav.w)-Math.floor(end/nav.w));
  const push=(k,f)=>{let i=heap.length;heap.push([k,f]);while(i){const p=(i-1)>>1;if(heap[p][1]<=f)break;heap[i]=heap[p];i=p;}heap[i]=[k,f];};
  const pop=()=>{const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][1]<heap[j][1])j++;if(heap[j][1]>=last[1])break;heap[i]=heap[j];i=j;}heap[i]=last;}return first[0];};
  push(start,h(start));let best=start,bestH=h(start),expanded=0;
  while(heap.length&&expanded<budget){const k=pop();if(closed.has(k))continue;closed.add(k);expanded++;if(k===end){best=k;break;}
    const x=k%nav.w,z=Math.floor(k/nav.w),g=cost.get(k)+1;
    for(const [xx,zz] of [[x-1,z],[x+1,z],[x,z-1],[x,z+1]]){if(xx<0||zz<0||xx>=nav.w||zz>=nav.h)continue;const q=zz*nav.w+xx;
      if(nav.blocked[q]||closed.has(q)||(cost.get(q)??Infinity)<=g)continue;
      cost.set(q,g);prev.set(q,k);const d=h(q);if(d<bestH){bestH=d;best=q;}push(q,g+d*1.001);
    }
  }
  nav.lastSearch={expanded,visited:cost.size,queued:heap.length};
  const result=[];let k=best;for(let guard=0;k!==start&&guard<=cost.size;guard++){result.push(nav.point(k));k=prev.get(k);if(k===undefined)return [];}
  return result.reverse();
}
