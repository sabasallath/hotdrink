/*####################################################################
 * The ContextBuilder class.
 */
module hd.model {

  import u = hd.utility;
  import r = hd.reactive;

  /*================================================================
   * The ContextBuilder class represents our embedded-DSL for
   * creating contexts.
   *
   * The various factory methods spend a lot of time validating
   * parameters and massaging them to fit the parameters of the actual
   * object constructors.  (The object constructors themselves assume
   * all parameters have been validated and are in the expected
   * format.)
   */
  export
  class ContextBuilder {

    // The spec we are building
    private
    target: ContextSpec = {
      variables:   [],
      nesteds:     [],
      references:  [],
      constraints: [],
      commands:    [],
      outputs:     [],
      touchDeps:   []
    };

    // If the last thing created was a constraint or a method in a
    // constraint, this will point to the constraint; otherwise it
    // will be null
    last: ConstraintSpec = null;

    usedLocs: u.Dictionary<boolean> = {};

    /*----------------------------------------------------------------
     * Get the spec constructed by this builder
     */
    spec() {
      this.endConstraint();
      return this.target;
    }

    /*----------------------------------------------------------------
     * Get a context made according to the spec
     */
    context( init?: u.Dictionary<any> ) {
      this.endConstraint();
      var ctx = new Context( init );
      Context.construct( ctx, this.target );
      return ctx;
    }

    /*----------------------------------------------------------------
     * Add a variable.
     */
    variable<T>( loc: string,
                 init?: T,
                 eq?: u.EqualityPredicate<T> ): ContextBuilder {
      this.endConstraint();

      if (this.invalidLoc( loc )) { return this; }

      if (eq && typeof eq !== 'function') {
        console.error( "Variable equality predicate must be a function" );
        return this;
      }

      this.target.variables.push( { loc: loc, init: init, eq: eq} );
      this.usedLocs[loc] = true;

      return this;
    }

    /*----------------------------------------------------------------
     * This convenience method allows the creation of a bunch of
     * variables at once.
     */
    variables( varorder: string, vardefs?: u.Dictionary<any> ): ContextBuilder;
    variables( vardefs: u.Dictionary<any> ): ContextBuilder;
    variables() {
      this.endConstraint();

      var varorder: string[];
      var vardefs: u.Dictionary<any>;
      var output: boolean;
      if (typeof arguments[0] === 'string') {
        varorder = arguments[0].trim().split( /\s*,\s*/ );
        vardefs = arguments[1] || {};
      }
      else {
        vardefs = arguments[0];
        varorder = Object.keys( vardefs );
      }

      for (var i = 0, l = varorder.length; i < l; ++i) {
        var loc = varorder[i];
        this.variable( loc, vardefs[loc] );
      }

      return this;
    }

    /*----------------------------------------------------------------
     * Add a nested context.
     */
    nested( loc: string, spec: ContextSpec ): ContextBuilder {
      this.endConstraint();

      if (this.invalidLoc( loc )) { return this; }

      this.target.nesteds.push( {loc: loc, spec: spec} );
      this.usedLocs[loc] = true;

      return this;
    }

    /*----------------------------------------------------------------
     * Add a reference.
     */
    reference( loc: string, eq?: u.EqualityPredicate<any> ): ContextBuilder {
      this.endConstraint();

      if (this.invalidLoc( loc )) { return this; }

      this.target.references.push( {loc: loc, eq: eq} );
      this.usedLocs[loc] = true;

      return this;
    }

    /*----------------------------------------------------------------
     * Convenience method for many references at once
     */
    references( locs: string ): ContextBuilder {
      locs.trim().split( /\s*,\s*/ ).forEach( function( loc: string ) {
        this.reference( loc )
      }, this );
      return this;
    }

    /*----------------------------------------------------------------
     */
    private
    parseSignature( description: string, signature: string ) {
      var inputs: string[], outputs: string[];
      var leftRight = signature.trim().split( /\s*->\s*/ );
      if (leftRight.length != 2) {
        console.error( 'Invalid ' + description + ' signature: "' + signature + '"' );
        return null;
      }
      inputs = leftRight[0] == '' ? [] : leftRight[0].split( /\s*,\s*/ );
      outputs = leftRight[1] == '' ? [] : leftRight[1].split( /\s*,\s*/ );

      var promiseFlags: boolean[] = [];
      var priorFlags: boolean[] = [];
      for (var i = 0, l = inputs.length; i < l; ++i) {
        var stripResult = strip( inputs[i], ['*', '!'] );
        if (! stripResult) { return null; }
        inputs[i] = stripResult['name'];
        if (stripResult['*']) { promiseFlags[i] = true; }
        if (stripResult['!']) { priorFlags[i] = true; }
      }

      return {inputs: inputs,
              promiseFlags: promiseFlags.length == 0 ? null : promiseFlags,
              priorFlags: priorFlags.length == 0 ? null : priorFlags,
              outputs: outputs
             };
    }

    /*----------------------------------------------------------------
     * Add a constraint to the property modelcule.
     */
    constraint( loc: string, signature: string ): ContextBuilder;
    constraint( signature: string ): ContextBuilder;
    constraint(): ContextBuilder {
      this.endConstraint();

      var loc: string, signature: string;
      if (arguments.length > 1) {
        loc = arguments[0];
        signature = arguments[1];
      }
      else {
        signature = arguments[0];
      }

      var varNames = signature.trim().split( /\s*,\s*/ );

      if (varNames.some( invalidPath, this )) {
         return this;
       }

      this.last = { variables: varNames, methods: [] };

      if (loc && ! this.invalidLoc( loc )) {
        this.last.loc = loc;
        this.usedLocs[this.last.loc] = true;
      }

      return this;
    }

    // Complete the current constraint; no effect if no current constraint
    endConstraint(): ContextBuilder {
      if (this.last) {
        this.target.constraints.push( this.last );
        this.last = null;
      }
      return this;
    }

    /*----------------------------------------------------------------
     * Add a method
     */
    method( signature: string, fn: Function, lift = true ): ContextBuilder {
      if (! this.last) {
        console.error( 'Builder function "method" called with no constraint' );
        return this;
      }

      var p = this.parseSignature( 'method', signature );
      if (p == null) { return this; }

      // helper function to make sure variable belongs to constraint
      var constraintVars = this.last.variables;
      var isNotConstraintVar = function( name: string ) {
        if (constraintVars.indexOf( name ) < 0) {
          console.error( "Variable " + name +
                         "does not belong to constraint in method " + signature );
          return true;
        }
        else { return false; }

      };

      if (p.inputs.some( isNotConstraintVar ) || p.outputs.some( isNotConstraintVar ) ) {
        return this;
      }

      u.arraySet.addKnownDistinct(
        this.last.methods,
        {inputs: p.inputs,
         priorFlags: p.priorFlags,
         outputs: p.outputs,
         fn: lift ? r.liftFunction( fn, p.outputs.length, p.promiseFlags ) : fn}
      );

      return this;
    }

    /*----------------------------------------------------------------
     */
    command( loc: string,
             signature: string,
             fn: Function,
             lift = true, sync = false ): ContextBuilder {
      this.endConstraint();

      if (this.invalidLoc( loc )) { return this; }

      var p = this.parseSignature( 'method', signature );
      if (p == null) { return this; }

      if (p.inputs.some( invalidPath, this ) || p.outputs.some( invalidPath, this )) {
        return this;
      }

      this.target.commands.push( {
        loc: loc,
        inputs: p.inputs,
        priorFlags: p.priorFlags,
        outputs: p.outputs,
        fn: lift ? r.liftFunction( fn, p.outputs.length, p.promiseFlags ) : fn,
        synchronous: sync
      } );

      return this;
    }

    //--------------------------------------------
    syncommand( loc: string, signature: string, fn: Function, lift = true ): ContextBuilder {
      return this.command( loc, signature, fn, lift, true );
    }

    /*----------------------------------------------------------------
     * Add output designation
     */
    output( variable: string ): ContextBuilder {
      if (invalidPath( variable )) {
        return this;
      }
      this.target.outputs.push( {variable: variable} );
      return this;
    }

    /*----------------------------------------------------------------
     * Convenience method for many outputs at once
     */
    outputs( variables: string ): ContextBuilder {
      variables.trim().split( /\s*,\s*/ ).forEach( this.output, this );
      return this;
    }

    /*----------------------------------------------------------------
     * Add a touch dependency
     */
    touchDep( from: string, to: string ): ContextBuilder {
      if (invalidPath( from ) || invalidPath( to )) {
        return this;
      }
      this.target.touchDeps.push( {from: from, to: to} );
      return this;
    }

    /*----------------------------------------------------------------
     * Build constraint represented by simple equation.
     */
    equation( eqString: string ): ContextBuilder {
      this.endConstraint();

      // Parse the equation
      try {
        var equation = eqn.parse( eqString );

        // Check variables
        var varNames = Object.keys( equation.vars );
        if (varNames.some( invalidPath, this )) {
          return this;
        }

        // Create constraint spec
        var cspec: ConstraintSpec = {
          variables: varNames,
          methods: []
        };

        var outName: string;
        var notOutput = function( name: string ) {
          return name !== outName;
        };

        for (var i = 0, l = varNames.length; i < l; ++i) {
          outName = varNames[i];

          var inNames: string[];
          var priorFlags: boolean[] = undefined;
          if (equation.op === '==') {
            inNames = varNames.filter( notOutput );
          }
          else {
            inNames = varNames;
            priorFlags = [];
            priorFlags[i] = true;
          }

          // Make signature
          var signature = inNames.join( ',' ) + '->' + outName;

          // Build method function
          var fn = eqn.makeFunction( inNames, outName, equation );

          // Create method spec
          var mspec: MethodSpec = {
            inputs: inNames,
            outputs: [outName],
            priorFlags: priorFlags,
            fn: r.liftFunction( fn )
          };

          // Add method to constraint
          u.arraySet.addKnownDistinct( cspec.methods, mspec );
        }

        // Record constraint
        this.target.constraints.push( cspec );
      }
      catch (e) {
        console.error( e );
      }

      return this;
    }

    /*----------------------------------------------------------------
     * Test for invalid property name
     */
    private
    invalidLoc( loc: string ): boolean {
      if (! loc.match( /^[a-zA-Z][\w$]*$/ )) {
        console.error( 'Invalid context property name: "' + loc + '"' );
        return true;
      }
      if (this.usedLocs[loc]) {
        console.error( 'Cannot redefine context property: "' + loc + '"' );
        return true;
      }
      return false;
    }
  }

  (<any>ContextBuilder).prototype['v']   = ContextBuilder.prototype.variable;
  (<any>ContextBuilder).prototype['vs']  = ContextBuilder.prototype.variables;
  (<any>ContextBuilder).prototype['n']   = ContextBuilder.prototype.nested;
  (<any>ContextBuilder).prototype['r']   = ContextBuilder.prototype.reference;
  (<any>ContextBuilder).prototype['rs']  = ContextBuilder.prototype.references;
  (<any>ContextBuilder).prototype['c']   = ContextBuilder.prototype.constraint;
  (<any>ContextBuilder).prototype['m']   = ContextBuilder.prototype.method;
  (<any>ContextBuilder).prototype['o']   = ContextBuilder.prototype.output;
  (<any>ContextBuilder).prototype['os']  = ContextBuilder.prototype.outputs;
  (<any>ContextBuilder).prototype['td']  = ContextBuilder.prototype.touchDep;
  (<any>ContextBuilder).prototype['eq']  = ContextBuilder.prototype.equation;

  /*==================================================================
   * Test for invalid variable path
   */
  function invalidPath( path: string ): boolean {
    if (! path.match( /^[a-zA-Z][\w$]*(\.[a-zA-Z][\w$]*)*$/ )) {
      console.error( 'Invalid variable path: "' + path + '"' );
      return true;
    }
    return false;
  }

  /*================================================================
   * Strip one-character prefixes from front of names
   */
  function strip( name: string, prefixes: string[] ) {
    var result: u.Dictionary<any> = {};
    var c = name.charAt( 0 );
    while (! c.match( /\w/ )) {
      if (prefixes.indexOf( c ) >= 0) {
        if (result[c]) {
          console.error( 'Duplicate variable prefix: ' + c );
          return null;
        }
        result[c] = true;
      }
      else if (! c.match( /\s/ )) {
        console.error( 'Invalid variable prefix: ' + c );
        return null;
      }
      name = name.substring( 1 );
      c = name.charAt( 0 );
    }
    result['name'] = name;
    return result;
  }

}
