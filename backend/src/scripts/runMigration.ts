import { migrateRequestItemsToSubCategories } from '../utils/migrateToSubCategories';

async function run() {
  console.log('Running migration...');
  const result = await migrateRequestItemsToSubCategories();
  console.log('Result:', result);
  process.exit(0);
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
