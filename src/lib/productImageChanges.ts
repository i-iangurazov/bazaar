export const isProductImageOnlyChange = (dirtyFields: unknown): boolean => {
  const paths: string[][] = [];
  const visit = (value: unknown, path: string[]) => {
    if (value === true) paths.push(path);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
    }
  };
  visit(dirtyFields, []);
  return (
    paths.length > 0 &&
    paths.every(
      (path) =>
        path[0] === "images" ||
        path[0] === "photoUrl" ||
        (path[0] === "variants" && ["imageId", "imageUrl"].includes(path[2])),
    )
  );
};
