"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import type { ComponentProps, ReactNode } from "react";

export function Drawer(props: ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root {...props} />;
}

export function DrawerTrigger(props: ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

export function DrawerClose(props: ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

export function DrawerTitle(props: ComponentProps<typeof DrawerPrimitive.Title>) {
  return <DrawerPrimitive.Title data-slot="drawer-title" {...props} />;
}

export function DrawerDescription(props: ComponentProps<typeof DrawerPrimitive.Description>) {
  return <DrawerPrimitive.Description data-slot="drawer-description" {...props} />;
}

export function DrawerContent({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Backdrop className="ui-drawer-backdrop" data-slot="drawer-overlay" />
      <DrawerPrimitive.Viewport className="ui-drawer-viewport">
        <DrawerPrimitive.Popup className={`ui-drawer-popup ${className}`.trim()} data-slot="drawer-content">
          <div aria-hidden="true" className="ui-drawer-handle" />
          <DrawerPrimitive.Content className="ui-drawer-inner">{children}</DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
}

export function DrawerHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <header className={`ui-drawer-header ${className}`.trim()} data-slot="drawer-header">{children}</header>;
}

export function DrawerFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <footer className={`ui-drawer-footer ${className}`.trim()} data-slot="drawer-footer">{children}</footer>;
}
