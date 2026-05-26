/**
 * Copy budget categories from prior FY / legacy dept into empty FY rows.
 * Usage: node backend/scratch/restore_budget_categories.js [fiscalYear]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const LEGACY_TO_CANONICAL = {
  m88it: 'IT Department',
  m88purchasing: 'Purchasing Department',
  m88planning: 'Planning Department',
  m88logistics: 'Logistics Department',
  m88hr: 'HR Department',
  m88accounting: 'Finance Department',
  m88admin: 'Admin Department',
  'accounting department': 'Finance Department'
};

const toNumber = (v) => Number.parseFloat(v ?? 0) || 0;
const toCanonical = (name) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  return LEGACY_TO_CANONICAL[trimmed.toLowerCase()] || trimmed;
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const targetFiscalYear = Number(process.argv[2]) || new Date().getFullYear();

async function fetchCategories(departmentIds, fiscalYear) {
  if (!departmentIds.length) return [];
  const { data, error } = await supabase
    .from('budget_categories')
    .select('*')
    .in('department_id', departmentIds)
    .eq('fiscal_year', fiscalYear)
    .order('category_name');
  if (error) throw error;
  return data || [];
}

async function findSourceCategories(canonicalName, targetDepartmentId) {
  const { data: allDepartments, error } = await supabase.from('departments').select('id, name, fiscal_year');
  if (error) throw error;

  const relatedIds = (allDepartments || [])
    .filter((d) => toCanonical(d.name) === canonicalName)
    .map((d) => d.id)
    .filter((id) => id !== targetDepartmentId);

  if (!relatedIds.length) return [];

  const { data: sourceCategories, error: catError } = await supabase
    .from('budget_categories')
    .select('*')
    .in('department_id', relatedIds)
    .order('fiscal_year', { ascending: false });

  if (catError) throw catError;
  if (!sourceCategories?.length) return [];

  const latestFY = Math.max(...sourceCategories.map((c) => Number(c.fiscal_year || 0)));
  const latest = sourceCategories.filter((c) => Number(c.fiscal_year) === latestFY);
  const byCode = new Map();
  latest.forEach((c) => {
    const code = String(c.category_code || '').trim().toUpperCase();
    if (code && !byCode.has(code)) byCode.set(code, c);
  });
  return Array.from(byCode.values());
}

async function copyCategories(sourceCategories, targetDepartmentId, fiscalYear) {
  const sourceById = new Map(sourceCategories.map((c) => [c.id, c]));
  const parents = sourceCategories.filter((c) => !c.parent_category_id);
  const children = sourceCategories.filter((c) => c.parent_category_id);
  const newIdByCode = new Map();
  const now = new Date().toISOString();

  for (const source of parents) {
    const code = String(source.category_code || '').trim().toUpperCase();
    const budgetAmount = toNumber(source.budget_amount);
    const { data: inserted, error } = await supabase
      .from('budget_categories')
      .insert({
        department_id: targetDepartmentId,
        fiscal_year: fiscalYear,
        category_code: code,
        category_name: source.category_name,
        budget_amount: budgetAmount,
        used_amount: 0,
        committed_amount: 0,
        remaining_amount: budgetAmount,
        parent_category_id: null,
        updated_at: now
      })
      .select('id, category_code')
      .single();
    if (error) throw error;
    if (inserted?.id) newIdByCode.set(code, inserted.id);
  }

  for (const source of children) {
    const code = String(source.category_code || '').trim().toUpperCase();
    const budgetAmount = toNumber(source.budget_amount);
    const parentSource = sourceById.get(String(source.parent_category_id || ''));
    const parentCode = parentSource ? String(parentSource.category_code || '').trim().toUpperCase() : '';
    const parentCategoryId = parentCode ? newIdByCode.get(parentCode) || null : null;

    const { error } = await supabase.from('budget_categories').insert({
      department_id: targetDepartmentId,
      fiscal_year: fiscalYear,
      category_code: code,
      category_name: source.category_name,
      budget_amount: budgetAmount,
      used_amount: 0,
      committed_amount: 0,
      remaining_amount: budgetAmount,
      parent_category_id: parentCategoryId,
      updated_at: now
    });
    if (error) throw error;
  }
}

async function restoreDepartment(department) {
  const existing = await fetchCategories([department.id], Number(department.fiscal_year));
  if (existing.length) {
    return { restored: false, count: existing.length };
  }

  const canonical = toCanonical(department.name);
  const source = await findSourceCategories(canonical, department.id);
  if (!source.length) {
    return { restored: false, count: 0 };
  }

  await copyCategories(source, department.id, Number(department.fiscal_year));
  const after = await fetchCategories([department.id], Number(department.fiscal_year));
  return { restored: true, count: after.length };
}

async function main() {
  const { data: yearDepartments, error } = await supabase
    .from('departments')
    .select('id, name, fiscal_year')
    .eq('fiscal_year', targetFiscalYear);

  if (error) throw error;

  console.log(`Restoring categories for FY ${targetFiscalYear}...\n`);

  for (const department of yearDepartments || []) {
    if (/^m88/i.test(String(department.name || ''))) continue;
    try {
      const result = await restoreDepartment(department);
      console.log(
        `  ${result.restored ? 'RESTORED' : 'skipped '}  ${department.name}: ${result.count} categories`
      );
    } catch (err) {
      console.error(`  FAILED       ${department.name}:`, err.message || err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
