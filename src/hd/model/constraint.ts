/*####################################################################
 * The Constraint class.
 */
module hd.model {

  import u = hd.utility;
  import r = hd.reactive;

  /*==================================================================
   * A constraint in the property model.
   */
  export class Constraint {

    // Static constants for min/max strength
    static WeakestStrength = Number.MIN_VALUE;
    static RequiredStrength = Number.MAX_VALUE;

    // Unique identifier; assigned by Factory
    id: string;

    // Human readable name for programmer
    name: string;

    // Variables used by this constraint
    variables: u.ArraySet<Variable> = [];

    // Methods in this constraint
    methods: u.ArraySet<Method> = [];

    /*----------------------------------------------------------------
     * Initialize members
     */
    constructor( name: string, variables: u.ArraySet<Variable> ) {
      this.id = makeId( name );
      this.name = name;
      this.variables = variables;
    }

    /*----------------------------------------------------------------
     * Human readable name
     */
    toString(): string {
      return this.name;
    }

    /*----------------------------------------------------------------
     * Add new method to constraint
     */
    addMethod( method: Method ) {
      (<Method[]>this.methods).push( method );
    }

  }

  /*==================================================================
   */

  export
  interface ConstraintTemplate {
    variables: u.ArraySet<string>;
    methods: u.ArraySet<MethodTemplate>;
  }

  export
  class ConstraintInstance {
    mod: Modelcule;
    template: ConstraintTemplate;
    reffed: u.Dictionary<any> = {};
    paths: u.ArraySet<Path> = [];
    constraint: Constraint;

    constructor( mod: Modelcule, template: ConstraintTemplate ) {
      this.mod = mod;
      this.template = template;
      template.variables.forEach( function( name: string ) {
        var path = new Path( mod, name.split( '.' ) );
        this.reffed[name] = path.get();
        if (! path.isConstant()) {
          path.addObserver( this, this.onPathNext, null, null, name );
          this.paths.push( path );
        }
      }, this );
      this.tryConstraint();
    }

    cancel() {
      this.paths.forEach( function( p: Path ) {
        p.removeObserver( this );
        p.cancel();
      } );
    }

    reffedValue( name: string ) {
      return this.reffed[name];
    }

    onPathNext( vv: Variable, name: string ) {
      if (this.constraint) {
        u.arraySet.remove( this.mod['#hd_data'].constraints, this.constraint );
        this.mod['#hd_data'].changes
              .sendNext( {type: ModelculeEventType.removeConstraint,
                          constraint: this.constraint
                         }
                       );
        this.constraint = null;
      }
      if (vv === undefined) {
        vv = null;
      }
      else if (vv !== null && ! (vv instanceof Variable)) {
        console.error( 'Non-variable value produced for ' + name );
        vv = null;
      }

      this.reffed[name] = vv;
      if (vv) {
        this.tryConstraint();
      }
    }

    tryConstraint() {
      var variables =
            u.arraySet.fromArray( this.template.variables.map( this.reffedValue, this ) );

      var allgood = variables.every( function( x: any ) { return x; } );

      if (allgood) {
        var cc = new Constraint( this.template.variables.join( ',' ), variables );
        this.template.methods.forEach( function( mtempl: MethodTemplate ) {
          var outputs = <Variable[]>mtempl.outputs.map( this.reffedValue, this );
          var inputs = mtempl.inputs.map( this.reffedValue, this );
          var outputVars = u.arraySet.fromArray( outputs );
          var inputVars = u.arraySet.difference( variables, outputs );
          var signature =
                [mtempl.inputs.join( ',' ),
                 mtempl.outputs.join( ',' )].join( '->' );
          var mm = new Method( signature,
                               inputVars,
                               outputVars,
                               mtempl.fn,
                               inputs,
                               outputs
                             );
          cc.addMethod( mm );
        }, this );

        this.constraint = cc;

        u.arraySet.addKnownDistinct( this.mod['#hd_data'].constraints, this.constraint );
        this.mod['#hd_data'].changes
              .sendNext( {type: ModelculeEventType.addConstraint,
                          constraint: this.constraint
                         }
                       );
      }
    }
  }

}