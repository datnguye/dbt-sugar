select count(*) as orders, sum(doubled) as total from {{ ref('fct_orders') }}
