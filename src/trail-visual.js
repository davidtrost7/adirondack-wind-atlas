import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const COLORS={yellow:0xf5c85e,red:0xf28b7c,blue:0x7ed5ed,unmarked:0xe8dac0};
export function makeTrailLayer(terrain,records,width,height,vertical=1) {
  const root=new THREE.Group();
  const geometryByColor=new Map(Object.keys(COLORS).map(key=>[key,[]]));
  const materialSet=[];
  const objects=[];
  let selected=null,show=true;
  const elevationAt=pt=>terrain.heightAt(pt.x,pt.z)+12;
  for(const rec of records)for(const path of rec.paths)for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i];
    geometryByColor.get(rec.marker||'unmarked').push(a.x,elevationAt(a),a.z,b.x,elevationAt(b),b.z);
  }
  for(const [key,positions] of geometryByColor) {
    if(!positions.length)continue;
    const geom=new LineSegmentsGeometry();geom.setPositions(positions);
    const mat=new LineMaterial({color:COLORS[key],linewidth:2.7,transparent:true,opacity:.96,depthTest:true,depthWrite:false});
    mat.resolution.set(width,height);
    const line=new LineSegments2(geom,mat);
    line.frustumCulled=false;
    line.renderOrder=4;
    root.add(line);objects.push(line);materialSet.push(mat);
  }
  const highGroup=new THREE.Group();root.add(highGroup);
  function selectTrail(rec){
    for(const child of [...highGroup.children]) {highGroup.remove(child);child.geometry.dispose();child.material.dispose();}
    selected=rec;
    if(!rec)return;
    for(const path of rec.paths){
      if(path.length<2)continue;
      const positions=[];
      for(const point of path)positions.push(point.x,elevationAt(point)+4,point.z);
      const geom=new LineGeometry();geom.setPositions(positions);
      const mat=new LineMaterial({color:0xfff7dd,linewidth:6,transparent:true,opacity:1,depthTest:true,depthWrite:false});
      mat.resolution.set(width,height);
      const line=new Line2(geom,mat);line.frustumCulled=false;line.renderOrder=6;
      highGroup.add(line);materialSet.push(mat);
    }
  }
  root.scale.y=vertical;
  return {
    group:root,records,selectTrail,
    get selected(){return selected;},
    resize(w,h){for(const mat of materialSet)mat.resolution.set(w,h);},
    setVertical(value){root.scale.y=value;},
    setVisible(value){show=value;root.visible=value;},
    get visible(){return show;},
    dispose(){for(const child of [...root.children,...highGroup.children]){
      if(child===highGroup)continue;
      child.geometry?.dispose();child.material?.dispose();
    }},
  };
}
