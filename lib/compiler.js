(function() {
  'use strict';

  function _resolve(expr, locals, env, data, index) {
    if (!expr || 
        typeof expr === 'boolean' || 
        typeof expr === 'string' || 
        typeof expr === 'number') {
      return expr;
    }
    if (expr._resolve) {
      // it's an Entity or an Attribute
      return expr._resolve(data, index);
    }
    index = index || [];
    var key = index.shift();
    // `var [locals, current] = expr(...)` is not ES5 (V8 doesn't support it)
    var current = expr(locals, env, data, key);
    locals = current[0], current = current[1];
    return _resolve(current, locals, env, data, index);
  }

  function Identifier(node) {
    var name = node.name;
    return function identifier(locals, env, data) {
      var entity = env.entries[name]
      return [{ __this__: entity }, entity]
    };
  }
  function ThisExpression(node) {
    return function thisExpression(locals, env, data) {
      return [locals, locals.__this__];
    };
  }
  function VariableExpression(node) {
    return function variableExpression(locals, env, data) {
      var value = locals[node.id.name];
      if (value !== undefined)
        return value;
      return [locals, data[node.id.name]];
    };
  }
  function GlobalsExpression(node) {
    return function globalsExpression(locals, env, data) {
      return [locals, env.globals[node.id.name]];
    };
  }
  function NumberLiteral(node) {
    return function numberLiteral(locals, env, data) {
      return [locals, node.value];
    };
  }
  function StringLiteral(node) {
    return function stringLiteral(locals, env, data) {
      return [locals, node.content];
    };
  }
  function ArrayLiteral(node) {
    var content = [];
    var defaultKey = 0;
    node.content.forEach(function(elem, i) {
      content.push(Expression(elem));
      if (elem.default)
        defaultKey = i;
    });
    return function arrayLiteral(locals, env, data, key) {
      key = _resolve(key, locals, env, data);
      if (key && content[key]) {
        return [locals, content[key]];
      } else {
        return [locals, content[defaultKey]];
      }
    };
  }
  function HashLiteral(node) {
    var content = [];
    var defaultKey = null;
    node.content.forEach(function(elem, i) {
      content[elem.key.name] = HashItem(elem);
      if (i == 0 || elem.default)
        defaultKey = elem.key.name;
    });
    return function hashLiteral(locals, env, data, key) {
      key = _resolve(key, locals, env, data);
      if (key && content[key]) {
        return [locals, content[key]];
      } else {
        return [locals, content[defaultKey]];
      }
    };
  }
  function HashItem(node) {
    // return the value expression right away
    // the `key` and the `default` flag logic is done in `HashLiteral`
    return Expression(node.value)
  }
  function ComplexString(node) {
    var content = [];
    node.content.forEach(function(elem) {
      content.push(Expression(elem));
    });
    // Every complexString needs to have its own `dirty` flag whose state 
    // persists across multiple calls to the given complexString.  On the other 
    // hand, `dirty` must not be shared by all complexStrings.  Hence the need 
    // to define `dirty` as a variable available in the closure.  Note that the 
    // anonymous function is a self-invoked one and it returns the closure 
    // immediately.
    return function() {
      var dirty = false;
      return function complexString(locals, env, data) {
        if (dirty) {
          throw new Error("Cyclic reference detected");
        }
        dirty = true;
        var parts = [];
        content.forEach(function resolveElemOfComplexString(elem) {
          var part = _resolve(elem, locals, env, data);
          parts.push(part);
        });
        dirty = false;
        return [locals, parts.join('')];
      }
    }();
  }

  function UnaryOperator(token) {
    if (token == '-') return function negativeOperator(argument) {
      return -argument;
    };
    if (token == '+') return function positiveOperator(argument) {
      return +argument;
    };
    if (token == '!') return function notOperator(argument) {
      return !argument;
    };
    throw new Error("Unknown token: " + token);
  }
  function BinaryOperator(token) {
    if (token == '==') return function equalOperator(left, right) {
      return left == right;
    };
    if (token == '!=') return function notEqualOperator(left, right) {
      return left != right;
    };
    if (token == '<') return function lessThanOperator(left, right) {
      return left < right;
    };
    if (token == '<=') return function lessThanEqualOperator(left, right) {
      return left <= right;
    };
    if (token == '>') return function greaterThanOperator(left, right) {
      return left > right;
    };
    if (token == '>=') return function greaterThanEqualOperator(left, right) {
      return left >= right;
    };
    if (token == '+') return function addOperator(left, right) {
      return left + right;
    };
    if (token == '-') return function substractOperator(left, right) {
      return left - right;
    };
    if (token == '*') return function multiplyOperator(left, right) {
      return left * right;
    };
    if (token == '/') return function devideOperator(left, right) {
      return left / right;
    };
    if (token == '%') return function moduloOperator(left, right) {
      return left % right;
    };
    throw new Error("Unknown token: " + token);
  }
  function LogicalOperator(token) {
    if (token == '&&') return function andOperator(left, right) {
      return left && right;
    };
    if (token == '||') return function orOperator(left, right) {
      return left || right;
    };
    throw new Error("Unknown token: " + token);
  }
  function UnaryExpression(node) {
    var operator = UnaryOperator(node.operator.token);
    var argument = Expression(node.argument);
    return function unaryExpression(locals, env, data) {
      return [locals, operator(_resolve(argument, locals, env, data))];
    };
  }
  function BinaryExpression(node) {
    var left = Expression(node.left);
    var operator = BinaryOperator(node.operator.token);
    var right = Expression(node.right);
    return function binaryExpression(locals, env, data) {
      return [locals, operator(
        _resolve(left, locals, env, data), 
        _resolve(right, locals, env, data)
      )];
    };
  }
  function LogicalExpression(node) {
    var left = Expression(node.left);
    if (node.operator) {
      var operator = LogicalOperator(node.operator.token);
      var right = Expression(node.right);
      return function logicalExpression(locals, env, data) {
        return [locals, operator(
          _resolve(left, locals, env, data), 
          _resolve(right, locals, env, data)
        )];
      }
    } else {
      return function logicalExpressionLeft(locals, env, data) {
        return _resolve(left, locals, env, data);
      }
    }
  }
  function ConditionalExpression(node) {
    var test = Expression(node.test);
    var consequent = Expression(node.consequent);
    var alternate = Expression(node.alternate);
    return function conditionalExpression(locals, env, data) {
      if (_resolve(test, locals, env, data)) {
        return consequent(locals, env, data);
      }
      return alternate(locals, env, data);
    };
  }

  function CallExpression(node) {
    var callee = Expression(node.callee);
    var args = [];
    node.arguments.forEach(function(elem, i) {
      args.push(Expression(elem));
    });
    return function callExpression(locals, env, data) {
      var evaluated_args = [];
      args.forEach(function(arg, i) {
        evaluated_args.push(arg(locals, env, data));
      });
      // callee is an expression pointing to a macro, e.g. an identifier
      // XXX what if it doesn't point to a macro?
      var macro = callee(locals, env, data);
      locals = macro[0], macro = macro[1];
      // rely entirely on the platform implementation to detect recursion
      return macro(locals, env, data, evaluated_args);
    };
  }
  function PropertyExpression(node) {
    var expression = Expression(node.expression);
    var property = node.computed ? 
      Expression(node.property) : 
      node.property.name;
    return function propertyExpression(locals, env, data) {
      var prop = _resolve(property, locals, env, data);
      var parent = expression(locals, env, data);
      locals = parent[0], parent = parent[1];
      if (parent._yield) {
        // it's an Entity or an Attribute
        return parent._yield(data, prop);
      }
      return parent(locals, env, data, prop);
    }
  }
  function AttributeExpression(node) {
    // XXX looks similar to PropertyExpression, but it's actually closer to 
    // Identifier
    var expression = Expression(node.expression);
    var attribute = node.computed ? 
      Expression(node.attribute) : 
      node.attribute.name;
    return function attributeExpression(locals, env, data) {
      var attr = _resolve(attribute, locals, env, data);
      var entity = expression(locals, env, data);
      locals = entity[0], entity = entity[1];
      // XXX what if it's not an entity?
      return [locals, entity.attributes[attr]];
    }
  }
  function ParenthesisExpression(node) {
    return Expression(node.expression);
  }

  function Expression(node) {
    var EXPRESSION_TYPES = {
      // primary expressions
      'Identifier': Identifier,
      'ThisExpression': ThisExpression,
      'VariableExpression': VariableExpression,
      'GlobalsExpression': GlobalsExpression,
      'Literal': NumberLiteral,
      'String': StringLiteral,
      'Array': ArrayLiteral,
      'Hash': HashLiteral,
      'HashItem': HashItem,
      'ComplexString': ComplexString,

      // logical expressions
      'UnaryExpression': UnaryExpression,
      'BinaryExpression': BinaryExpression,
      'LogicalExpression': LogicalExpression,
      'ConditionalExpression': ConditionalExpression,

      // member expressions
      'CallExpression': CallExpression,
      'PropertyExpression': PropertyExpression,
      'AttributeExpression': AttributeExpression,
      'ParenthesisExpression': ParenthesisExpression,
    };
    if (!node || !EXPRESSION_TYPES[node.type]) {
      return null;
    }
    return EXPRESSION_TYPES[node.type](node);
  }

  function Attribute(node, entity) {
    this.key = node.key.name;
    this.local = node.local || false;
    this.value = Expression(node.value);
    this.entity = entity;
  }
  Attribute.prototype._yield = function A_yield(data, key) {
    var locals = {
      __this__: this.entity,
    };
    return this.value(locals, this.entity.env, data, key);
  };
  Attribute.prototype._resolve = function A_resolve(data, index) {
    index = index || this.entity.index;
    var locals = {
      __this__: this.entity,
    };
    return _resolve(this.value, locals, this.entity.env, data, index);
  };
  Attribute.prototype.toString = function toString(data) {
    return this._resolve(data);
  };

  function Entity(node, env) {
    this.id = node.id;
    this.value = Expression(node.value);
    this.index = [];
    node.index.forEach(function(ind) {
      this.index.push(Expression(ind));
    }, this);
    this.attributes = {};
    for (var key in node.attrs) {
      this.attributes[key] = new Attribute(node.attrs[key], this);
    }
    this.local = node.local || false;
    this.env = env;
  }
  Entity.prototype._yield = function E_yield(data, key) {
    var locals = {
      __this__: this,
    };
    return this.value(locals, this.env, data, key);
  };
  Entity.prototype._resolve = function E_resolve(data, index) {
    index = index || this.index;
    var locals = {
      __this__: this,
    };
    return _resolve(this.value, locals, this.env, data, index);
  };
  Entity.prototype.toString = function toString(data) {
    return this._resolve(data);
  };

  function Macro(node) {
    var expression = Expression(node.expression);
    return function(locals, env, data, args) {
      // XXX extend locals?
      node.args.forEach(function(arg, i) {
        locals[arg.id.name] = args[i];
      });
      return expression(locals, env, data);
    };
  }

  var Compiler;

  if (typeof exports !== 'undefined') {
    Compiler = exports;
  } else {
    Compiler = this.L20n.Compiler = {};
  }

  Compiler.compile = function compile(ast, entries, globals) {
    var env = {
      entries: entries,
      globals: globals,
    };
    for (var i = 0, entry; entry = ast[i]; i++) {
      if (entry.type == 'Entity') {
        env.entries[entry.id.name] = new Entity(entry, env);
      } else if (entry.type == 'Macro')
        env.entries[entry.id.name] = new Macro(entry);
    }
  }

}).call(this);