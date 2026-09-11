'use client';

import { useEffect } from 'react';

/**
 * Defensive patch for Node.prototype.removeChild and Node.prototype.insertBefore.
 * Prevents third-party scripts (e.g. Google Translate, browser extensions) from crashing
 * React with "NotFoundError: Failed to execute 'removeChild' on 'Node'".
 */
if (typeof window !== 'undefined') {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      if (child.parentNode) {
        return child.parentNode.removeChild(child);
      }
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (referenceNode.parentNode) {
        return referenceNode.parentNode.insertBefore(newNode, referenceNode);
      }
      return this.appendChild(newNode) as T;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}

export function DomPatch() {
  useEffect(() => {
    // Ensures client execution on mount
  }, []);
  return null;
}
