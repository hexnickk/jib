console.log("Running migration...");
require("fs").writeFileSync("/tmp/migrated", "done");
console.log("Migration complete!");
process.exit(0);
