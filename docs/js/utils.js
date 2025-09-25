export function safeId(name) {
  return "id_" + btoa(unescape(encodeURIComponent(name))).replace(/[^a-zA-Z0-9]/g, "");
}

export function invertGroups(childToParent, images) {
  const parentToChild = {};
  function addRelation(parent, child, relationText) {
    if (!parent) return;
    if (!parentToChild[parent]) parentToChild[parent] = {};
    parentToChild[parent][child] = relationText;
  }
  for(const [childKey,parentSpec] of Object.entries(childToParent)){
    const cleanChild = childKey.startsWith("c_")?childKey:childKey;
    if(typeof parentSpec==="string") {
      if(parentSpec) addRelation(parentSpec, cleanChild,"");
    }
    else if(Array.isArray(parentSpec)) {
      parentSpec.forEach(p=>{ if(p) addRelation(p, cleanChild,""); });
    }
    else if(typeof parentSpec==="object") {
      for(const [p,rel] of Object.entries(parentSpec)) if(p) addRelation(p, cleanChild, rel);
    }
  }
  return parentToChild;
}
