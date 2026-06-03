const { supabase } = require('./utils/supabase');
const { authenticate, authorize } = require('./utils/auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);

    if (event.httpMethod === 'GET') {
      let query = supabase.from('direct_expenses').select('*');
      if (user.role === 'supervisor') {
        query = query.eq('logged_by', user.id);
      }
      const { data, error } = await query;
      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    if (event.httpMethod === 'POST') {
      authorize(['supervisor'])(user);

      const { item_name, category_id, category, amount, description, expense_date } = JSON.parse(event.body);
      const { data: dept, error: deptError } = await supabase.from('departments').select('*').eq('id', user.department_id).single();
      if (deptError || !dept) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Department not found' }) };
      }

      const targetFiscalYear = Number(dept.fiscal_year) || new Date().getFullYear();
      let categoryQuery = supabase
        .from('budget_categories')
        .select('id, category_name, remaining_amount, used_amount, budget_amount')
        .eq('department_id', user.department_id)
        .eq('fiscal_year', targetFiscalYear);

      if (category_id) {
        categoryQuery = categoryQuery.eq('id', category_id);
      } else if (category) {
        categoryQuery = categoryQuery.eq('category_name', String(category).trim());
      } else {
        return { statusCode: 400, body: JSON.stringify({ error: 'Category is required' }) };
      }

      const { data: categoryBudget, error: categoryError } = await categoryQuery.maybeSingle();
      if (categoryError) {
        return { statusCode: 400, body: JSON.stringify({ error: categoryError.message }) };
      }
      if (!categoryBudget) {
        return { statusCode: 400, body: JSON.stringify({ error: `Category not found for fiscal year ${targetFiscalYear}` }) };
      }

      const amountValue = toNumber(amount);
      if (amountValue <= 0) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Amount must be greater than zero' }) };
      }

      if (toNumber(categoryBudget.remaining_amount) < amountValue) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Insufficient category budget' }) };
      }

      const { data, error } = await supabase
        .from('direct_expenses')
        .insert({
          department_id: user.department_id,
          logged_by: user.id,
          item_name,
          category: categoryBudget.category_name,
          amount: amountValue,
          description,
          expense_date
        })
        .select()
        .single();

      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

      await supabase.from('budget_categories').update({
        used_amount: toNumber(categoryBudget.used_amount) + amountValue,
        remaining_amount: Math.max(0, toNumber(categoryBudget.remaining_amount) - amountValue)
      }).eq('id', categoryBudget.id);

      await supabase.from('departments').update({ used_budget: toNumber(dept.used_budget) + amountValue }).eq('id', dept.id);

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};