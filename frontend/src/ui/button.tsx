import type { ComponentProps, ComponentPropsWithoutRef } from "react";
import { Link } from "react-router";

import { buttonClassName, type ButtonSize, type ButtonVariant } from "./button-styles.ts";

type SharedProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

/** `ComponentProps` preserves React 19's ordinary ref prop forwarding. */
type ButtonProps = Omit<ComponentProps<"button">, "className"> & SharedProps;

export function Button({
  variant = "surface",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={`${buttonClassName(variant, size)} ${className}`} {...rest} />
  );
}

type LinkButtonProps = Omit<ComponentPropsWithoutRef<typeof Link>, "className"> & SharedProps;

export function LinkButton({
  variant = "surface",
  size = "md",
  className = "",
  ...rest
}: LinkButtonProps) {
  return <Link className={`${buttonClassName(variant, size)} ${className}`} {...rest} />;
}
