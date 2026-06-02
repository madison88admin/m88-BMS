const { supabase } = require('./utils/supabase');
const { authenticate, authorize } = require('./utils/auth');
const { toNumber } = require('./utils/budget');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);

    if (event.httpMethod === 'GET') {
      const pathParts = event.path.split('/').filter(Boolean);
      const lastSegment = pathParts[pathParts.length - 1];
      const secondLast = pathParts[pathParts.length - 2];

      // Handle budget-breakdown endpoint
      if (lastSegment === 'budget-breakdown' && secondLast) {
        const departmentId = secondLast;
        
        const { data: department, error: deptError } = await supabase
          .from('departments')
          .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance')
          .eq('id', departmentId)
          .single();

        if (deptError || !department) {
          return { statusCode: 404, body: JSON.stringify({ error: 'Department not found' }) };
        }

        // Fetch budget categories with sync logic
        const { data: budgetCategories } = await supabase
          .from('budget_categories')
          .select('*')
          .eq('department_id', departmentId)
          .eq('fiscal_year', department.fiscal_year);

        // Sync expense categories as sub-categories
        const { data: expenseCategories } = await supabase
          .from('expense_categories')
          .select('code, description, main_category_code')
          .neq('main_category_code', null);

        if (expenseCategories?.length) {
          const mainCategoryByCode = new Map(
            (budgetCategories || [])
              .filter(cat => !cat.parent_category_id)
              .map(cat => [String(cat.category_code || '').trim().toUpperCase(), cat])
          );

          for (const ec of expenseCategories) {
            const mainCode = String(ec.main_category_code || '').trim().toUpperCase();
            const parentCategory = mainCategoryByCode.get(mainCode);
            
            if (!parentCategory) continue;

            const { data: existingSub } = await supabase
              .from('budget_categories')
              .select('id')
              .eq('category_code', ec.code)
              .eq('department_id', parentCategory.department_id)
              .eq('fiscal_year', department.fiscal_year)
              .maybeSingle();

            if (!existingSub) {
              await supabase
                .from('budget_categories')
                .insert({
                  department_id: parentCategory.department_id,
                  fiscal_year: department.fiscal_year,
                  category_code: ec.code,
                  category_name: ec.description,
                  budget_amount: 0,
                  used_amount: 0,
                  committed_amount: 0,
                  remaining_amount: 0,
                  parent_category_id: parentCategory.id
                });
            }
          }

          // Re-fetch categories to include newly created sub-categories
          const { data: updatedCategories } = await supabase
            .from('budget_categories')
            .select('*')
            .eq('department_id', departmentId)
            .eq('fiscal_year', department.fiscal_year);

          return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
              department,
              categories: updatedCategories || [],
              totals: { annual_budget: department.annual_budget, used_budget: department.used_budget }
            }),
          };
        }

        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            department,
            categories: budgetCategories || [],
            totals: { annual_budget: department.annual_budget, used_budget: department.used_budget }
          }),
        };
      }

      // Default GET handler for all departments
      const { data, error } = await supabase.from('departments').select('*');
      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    if (event.httpMethod === 'PATCH') {
      authorize(['accounting', 'admin'])(user);

      const pathParts = event.path.split('/');
      const deptId = pathParts[pathParts.length - 2];
      const action = pathParts[pathParts.length - 1];

      if (action === 'budget') {
        const { annual_budget } = JSON.parse(event.body);

        const { data, error } = await supabase
          .from('departments')
          .update({ annual_budget, updated_at: new Date() })
          .eq('id', deptId)
          .select()
          .single();

        if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify(data),
        };
      }

      return { statusCode: 404, body: JSON.stringify({ error: 'Action not found' }) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};