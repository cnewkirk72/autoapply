// The @types/pdf-parse package only declares the top-level "pdf-parse"
// entry point, not the internal "pdf-parse/lib/pdf-parse.js" path that we
// import directly to dodge the package's "test file at module load" bug.
// Re-export the same types from the deep import so TypeScript is happy.
declare module "pdf-parse/lib/pdf-parse.js" {
  import pdfParse from "pdf-parse";
  export default pdfParse;
}
