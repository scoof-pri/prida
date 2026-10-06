"""Strip mesh, material and embedded texture objects while preserving original FBX motion.
No source files are changed. Rebuild absolute FBX node offsets for small animation-only exports.
"""
from __future__ import annotations
from pathlib import Path
from dataclasses import dataclass
import struct, zipfile, json, hashlib, argparse

@dataclass
class Node:
    name: bytes
    nprop: int
    props: bytes
    children: list
    has_null: bool


def values(data, n):
    out=[]; p=0
    scalar={'Y':('<h',2),'C':('<?',1),'I':('<i',4),'F':('<f',4),'D':('<d',8),'L':('<q',8)}
    for _ in range(n):
        t=chr(data[p]); p+=1
        if t in scalar:
            fmt,size=scalar[t]; out.append(struct.unpack_from(fmt,data,p)[0]);p+=size
        elif t in ('S','R'):
            size=struct.unpack_from('<I',data,p)[0];p+=4
            value=data[p:p+size]; p+=size
            out.append(value.decode('utf8','replace') if t=='S' else value)
        elif t in 'fdilbc':
            count,encoding,size=struct.unpack_from('<III',data,p);p+=12
            out.append({'array':t,'count':count}); p+=size
        else: raise ValueError(f'Unsupported property type {t!r}')
    return out


def strip_file(source: Path, dest: Path):
    removed=set(); removed_counts={}; counts={}; names=[]
    with source.open('rb') as f:
        header=f.read(27)
        if not header.startswith(b'Kaydara FBX Binary  \0\x1a\0'): raise ValueError(f'Not binary FBX: {source}')
        version=struct.unpack_from('<I',header,23)[0]
        fmt='<QQQB' if version>=7500 else '<IIIB'; size=struct.calcsize(fmt)
        def read(pos, parent=None):
            f.seek(pos); raw=f.read(size)
            end,nprop,plen,nlen=struct.unpack(fmt,raw)
            if not end:return None,pos+size
            if end<=pos or end>source.stat().st_size: raise ValueError('Invalid FBX node offset')
            name=f.read(nlen); props=f.read(plen)
            if parent==b'Objects':
                v=values(props,nprop)
                drop=name in (b'Geometry',b'Material',b'Texture',b'Video',b'Deformer',b'Pose') or (name==b'Model' and len(v)>2 and v[2]=='Mesh')
                if drop:
                    if v and isinstance(v[0],int): removed.add(v[0])
                    key=name.decode(); removed_counts[key]=removed_counts.get(key,0)+1
                    return None,end
                key=name.decode(); counts[key]=counts.get(key,0)+1
                if name==b'Model':names.append(v[1].split('\0')[0])
            children=[];null=False;p=f.tell()
            while p<end:
                child,nxt=read(p,name)
                if nxt<=p:raise ValueError('Invalid child offset')
                if child:children.append(child)
                elif nxt==p+size: null=True
                p=nxt
            return Node(name,nprop,props,children,null),end
        nodes=[];p=27
        while p<source.stat().st_size:
            n,nxt=read(p)
            if n is None:break
            nodes.append(n);p=nxt
        f.seek(nxt);footer=f.read()
    for n in nodes:
        if n.name==b'Connections':
            keep=[]
            for c in n.children:
                v=values(c.props,c.nprop)
                if len(v)>2 and (v[1] in removed or v[2] in removed):continue
                keep.append(c)
            n.children=keep
    def encode(node,start):
        p=start+size+len(node.name)+len(node.props); children=[]
        for ch in node.children:
            b=encode(ch,p); children.append(b);p+=len(b)
        if node.has_null: children.append(bytes(size));p+=size
        return struct.pack(fmt,p,node.nprop,len(node.props),len(node.name))+node.name+node.props+b''.join(children)
    data=bytearray(header)
    for n in nodes:data.extend(encode(n,len(data)))
    data.extend(bytes(size));data.extend(footer)
    dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
    with source.open('rb') as src:
        digest=hashlib.file_digest(src,'sha256').hexdigest()
    return {'source':source.name,'bytes':source.stat().st_size,'motionBytes':len(data),'fbxVersion':version,'objects':counts,'removed':removed_counts,'bones':names,'sourceSha256':digest}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('source',type=Path);ap.add_argument('out',type=Path);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True);manifest=[]
    for p in sorted(args.source.glob('*.fbx')):
        m=strip_file(p,args.out/p.name);manifest.append(m)
        print(p.name, m['bytes'], '->',m['motionBytes'],len(m['bones']),'bones')
    for p in sorted(args.source.glob('*.zip')):
        with zipfile.ZipFile(p) as z:
            if sum(i.file_size for i in z.infolist())>256*1024*1024:raise ValueError('Oversized source archive')
            seen=set()
            for info in z.infolist():
                pp=Path(info.filename)
                if pp.is_absolute() or '..' in pp.parts:raise ValueError('Unsafe archive member')
                if pp.suffix.lower()!='.fbx':continue
                if pp.name in seen:raise ValueError('Duplicate archive filename')
                seen.add(pp.name)
                if info.file_size>200_000_000:raise ValueError('Oversized archive member')
                target=args.out/'archive-source'/pp.name; target.parent.mkdir(exist_ok=True)
                with z.open(info) as src,target.open('wb') as dst:
                    import shutil;shutil.copyfileobj(src,dst,1024*1024)
                m=strip_file(target,args.out/'pack'/pp.name);m['archive']=p.name;manifest.append(m)
                print(p.name+'/'+pp.name,m['bytes'],'->',m['motionBytes'],len(m['bones']),'bones')
    (args.out/'manifest.json').write_text(json.dumps(manifest,indent=2))

if __name__=='__main__':main()
