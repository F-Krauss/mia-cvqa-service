declare const JwtStrategy_base: new (...args: any) => any;
export declare class JwtStrategy extends JwtStrategy_base {
    constructor();
    validate(payload: any): Promise<{
        sub: any;
        email: any;
        organizationId: any;
        firstName: any;
        lastName: any;
        roles: any;
        roleLevels: any;
        permissions: any;
        plants: any;
        areas: any;
    }>;
}
export {};
